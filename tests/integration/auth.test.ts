import { afterEach, describe, expect, it } from 'vitest';
import { freshDb, standardSetupInput, ADMIN_USER, ADMIN_PASSWORD, type TestCtx } from './helpers';
import { completeSetup, validateSetup, isSetupCompleted } from '../../src/main/services/setup';
import { sessionManager } from '../../src/main/services/session';
import { AppError, PermissionDeniedError } from '../../src/main/util/errors';
import { getDb } from '../../src/main/db/connection';
import { createUser, listUsers, setUserActive } from '../../src/main/services/users';
import { hashPassword, verifyPassword } from '../../src/main/services/security';

let ctx: TestCtx;
afterEach(() => ctx?.cleanup());

describe('first-run setup', () => {
  it('rejects invalid setup input with specific errors', () => {
    ctx = freshDb();
    const input = standardSetupInput();
    input.clinic.name = '';
    input.admin.password = '123';
    input.admin.confirmPassword = '456';
    input.dentists = [];
    const errs = validateSetup(input);
    expect(errs.some((e) => e.includes('Clinic name'))).toBe(true);
    expect(errs.some((e) => e.includes('at least 6'))).toBe(true);
    expect(errs.some((e) => e.includes('do not match'))).toBe(true);
    expect(errs.some((e) => e.includes('dentist'))).toBe(true);
  });

  it('commits clinic, dentists and admin in one transaction', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    expect(isSetupCompleted()).toBe(true);
    const db = getDb();
    expect(db.prepare('SELECT name FROM clinic WHERE id = 1').get<{ name: string }>()!.name).toBe('Test Dental Care');
    expect(db.prepare('SELECT COUNT(*) AS c FROM dentists').get<{ c: number }>()!.c).toBe(1);
    const admin = db.prepare('SELECT * FROM users WHERE username = ?').get<{ password_hash: string; salt: string }>(ADMIN_USER)!;
    expect(admin.password_hash).not.toBe(ADMIN_PASSWORD); // never plaintext
    expect(verifyPassword(ADMIN_PASSWORD, admin.password_hash, admin.salt)).toBe(true);
    const role = db.prepare("SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id JOIN users u ON u.id = ur.user_id WHERE u.username = ?").get<{ name: string }>(ADMIN_USER)!;
    expect(role.name).toBe('Admin');
    // holidays stored
    expect(db.prepare('SELECT COUNT(*) AS c FROM holidays').get<{ c: number }>()!.c).toBe(1);
    // audited
    expect(db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'setup.completed'").get<{ c: number }>()!.c).toBe(1);
  });

  it('cannot run setup twice', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    expect(() => completeSetup(standardSetupInput())).toThrow();
  });
});

describe('authentication & sessions', () => {
  it('logs in with valid credentials and loads permissions', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    const user = sessionManager.login(ADMIN_USER, ADMIN_PASSWORD);
    expect(user.username).toBe(ADMIN_USER);
    expect(user.permissions.has('patients.create')).toBe(true);
    expect(user.roles).toContain('Admin');
    expect(sessionManager.isLocked()).toBe(false);
    // login event recorded
    const ev = getDb().prepare('SELECT success FROM login_events ORDER BY id DESC LIMIT 1').get<{ success: number }>()!;
    expect(ev.success).toBe(1);
  });

  it('rejects invalid credentials with a generic message (no enumeration)', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    let msg = '';
    try {
      sessionManager.login(ADMIN_USER, 'wrong-password');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe('Invalid username or password.');
    let msg2 = '';
    try {
      sessionManager.login('ghost-user', 'whatever');
    } catch (e) {
      msg2 = (e as Error).message;
    }
    expect(msg2).toBe('Invalid username or password.');
  });

  it('locks the account after 5 failed attempts', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    for (let i = 0; i < 5; i++) {
      try {
        sessionManager.login(ADMIN_USER, 'nope');
      } catch {
        /* expected */
      }
    }
    // Even the correct password is refused while the lockout window is active.
    expect(() => sessionManager.login(ADMIN_USER, ADMIN_PASSWORD)).toThrow('Invalid username or password.');
    const u = getDb().prepare('SELECT locked_until FROM users WHERE username = ?').get<{ locked_until: string | null }>(ADMIN_USER)!;
    expect(u.locked_until).not.toBeNull();
  });

  it('lock/unlock requires the password again and blocks work while locked', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    sessionManager.login(ADMIN_USER, ADMIN_PASSWORD);
    sessionManager.lock('manual');
    expect(sessionManager.isLocked()).toBe(true);
    expect(() => sessionManager.ensurePermission('patients.view')).toThrow();
    expect(() => sessionManager.unlock('bad')).toThrow();
    sessionManager.unlock(ADMIN_PASSWORD);
    expect(sessionManager.isLocked()).toBe(false);
    expect(() => sessionManager.ensurePermission('patients.view')).not.toThrow();
  });

  it('logout ends the session', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    sessionManager.login(ADMIN_USER, ADMIN_PASSWORD);
    sessionManager.logout();
    expect(sessionManager.hasSession()).toBe(false);
    expect(() => sessionManager.currentUser()).toThrow();
  });
});

describe('RBAC enforcement at the service layer', () => {
  it('a receptionist-role user cannot access accounting', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    sessionManager.login(ADMIN_USER, ADMIN_PASSWORD);
    const recRole = getDb().prepare("SELECT id FROM roles WHERE name = 'Receptionist'").get<{ id: number }>()!.id;
    createUser({ username: 'front-desk', password: 'DeskPass!9', displayName: 'Front Desk', roleIds: [recRole] });
    sessionManager.logout();

    sessionManager.login('front-desk', 'DeskPass!9');
    expect(sessionManager.currentUser().permissions.has('patients.view')).toBe(true);
    expect(sessionManager.currentUser().permissions.has('accounting.view')).toBe(false);
    expect(() => sessionManager.ensurePermission('accounting.view')).toThrow(PermissionDeniedError);
    // financial service boundary uses the same gate:
    expect(() => sessionManager.ensurePermission('invoices.delete')).toThrow(PermissionDeniedError);
  });

  it('disabled users cannot sign in', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    sessionManager.login(ADMIN_USER, ADMIN_PASSWORD);
    const recRole = getDb().prepare("SELECT id FROM roles WHERE name = 'Dentist'").get<{ id: number }>()!.id;
    const created = createUser({ username: 'dentist1', password: 'DentPass!9', displayName: 'Dentist One', roleIds: [recRole] });
    setUserActive(created.id, false);
    sessionManager.logout();
    expect(() => sessionManager.login('dentist1', 'DentPass!9')).toThrow(AppError);
  });

  it('user list itself is permission-gated', () => {
    ctx = freshDb();
    completeSetup(standardSetupInput());
    sessionManager.login(ADMIN_USER, ADMIN_PASSWORD);
    const recRole = getDb().prepare("SELECT id FROM roles WHERE name = 'Receptionist'").get<{ id: number }>()!.id;
    createUser({ username: 'front-desk2', password: 'DeskPass!9', displayName: 'FD2', roleIds: [recRole] });
    sessionManager.logout();
    sessionManager.login('front-desk2', 'DeskPass!9');
    expect(() => listUsers()).toThrow(PermissionDeniedError);
  });
});

describe('password hashing', () => {
  it('scrypt hashes verify and salts differ per user', () => {
    const a = hashPassword('secret-password-1');
    const b = hashPassword('secret-password-1');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(verifyPassword('secret-password-1', a.hash, a.salt)).toBe(true);
    expect(verifyPassword('secret-password-2', a.hash, a.salt)).toBe(false);
    expect(verifyPassword('secret-password-1', a.hash, 'deadbeef')).toBe(false);
  });
});
