/**
 * User & role management. All mutating operations require 'users.manage' and are
 * enforced here at the service boundary (never only in UI).
 */
import { getDb, tx } from '../db/connection';
import { hashPassword, validatePasswordStrength, verifyPassword } from './security';
import { sessionManager } from './session';
import { ValidationError, AppError, NotFoundError } from '../util/errors';
import { nowIso } from '../../shared/datetime';
import { audit } from './audit';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  staff_id: number | null;
  is_active: number;
  is_locked: number;
  last_login_at: string | null;
  created_at: string;
  roles: string[];
}

export function listUsers(): UserRow[] {
  sessionManager.ensurePermission('users.view');
  const rows = getDb()
    .prepare(
      `SELECT id, username, display_name, staff_id, is_active, is_locked, last_login_at, created_at
       FROM users ORDER BY created_at ASC`,
    )
    .all<Omit<UserRow, 'roles'>>();
  return rows.map((r) => ({
    ...r,
    roles: getDb()
      .prepare('SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?')
      .all<{ name: string }>(r.id)
      .map((x) => x.name),
  }));
}

export function createUser(input: {
  username: string;
  password: string;
  displayName: string;
  staffId?: number | null;
  roleIds: number[];
}): UserRow {
  sessionManager.ensurePermission('users.manage');
  const username = input.username.trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new ValidationError('Username must be 3–32 characters (letters, numbers, dot, dash, underscore).');
  }
  const pwErr = validatePasswordStrength(input.password);
  if (pwErr) throw new ValidationError(pwErr);
  if (!input.displayName.trim()) throw new ValidationError('Display name is required.');
  if (!input.roleIds.length) throw new ValidationError('At least one role is required.');

  const db = getDb();
  const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (exists) throw new ValidationError('This username is already taken.');

  const at = nowIso();
  const { hash, salt } = hashPassword(input.password);
  let id = 0;
  tx(() => {
    const res = db
      .prepare(
        'INSERT INTO users (username, password_hash, salt, display_name, staff_id, is_active, is_locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)',
      )
      .run(username, hash, salt, input.displayName.trim(), input.staffId ?? null, at, at);
    id = res.lastInsertRowid;
    const ins = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
    for (const roleId of input.roleIds) ins.run(id, roleId);
    audit({ action: 'user.created', entity: 'user', entityId: id, details: { username } });
  });
  return listUsers().find((u) => u.id === id)!;
}

export function setUserActive(userId: number, active: boolean): void {
  sessionManager.ensurePermission('users.manage');
  if (userId === sessionManager.currentUser().userId && !active) {
    throw new ValidationError('You cannot disable your own account while signed in.');
  }
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw new NotFoundError('User');
  db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowIso(), userId);
  audit({ action: active ? 'user.enabled' : 'user.disabled', entity: 'user', entityId: userId });
}

export function setUserLocked(userId: number, locked: boolean): void {
  sessionManager.ensurePermission('users.manage');
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw new NotFoundError('User');
  db.prepare('UPDATE users SET is_locked = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(
    locked ? 1 : 0,
    nowIso(),
    userId,
  );
  audit({ action: locked ? 'user.locked' : 'user.unlocked', entity: 'user', entityId: userId });
}

export function resetUserPassword(userId: number, newPassword: string): void {
  sessionManager.ensurePermission('users.manage');
  const pwErr = validatePasswordStrength(newPassword);
  if (pwErr) throw new ValidationError(pwErr);
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw new NotFoundError('User');
  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(
    hash,
    salt,
    nowIso(),
    userId,
  );
  audit({ action: 'user.password_reset', entity: 'user', entityId: userId });
}

export function assignUserRoles(userId: number, roleIds: number[]): void {
  sessionManager.ensurePermission('users.manage');
  if (!roleIds.length) throw new ValidationError('At least one role is required.');
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw new NotFoundError('User');
  tx(() => {
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
    for (const roleId of roleIds) ins.run(userId, roleId);
    audit({ action: 'user.roles_changed', entity: 'user', entityId: userId });
  });
  sessionManager.refreshPermissions();
}

export function changeOwnPassword(currentPassword: string, newPassword: string): void {
  const me = sessionManager.currentUser();
  const db = getDb();
  const user = db.prepare('SELECT password_hash, salt FROM users WHERE id = ?').get<{ password_hash: string; salt: string }>(me.userId);
  if (!user) throw new NotFoundError('User');
  if (!verifyPassword(currentPassword, user.password_hash, user.salt)) {
    throw new AppError('AUTH_FAILED', 'Current password is incorrect.');
  }
  const pwErr = validatePasswordStrength(newPassword);
  if (pwErr) throw new ValidationError(pwErr);
  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?').run(hash, salt, nowIso(), me.userId);
  audit({ action: 'user.password_changed', entity: 'user', entityId: me.userId });
}

// --- roles ------------------------------------------------------------------

export function listRoles() {
  sessionManager.ensurePermission('users.view');
  const db = getDb();
  const roles = db.prepare('SELECT id, name, is_builtin, description FROM roles ORDER BY id').all<{
    id: number;
    name: string;
    is_builtin: number;
    description: string;
  }>();
  return roles.map((r) => ({
    ...r,
    permissions: db
      .prepare('SELECT p.key FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = ?')
      .all<{ key: string }>(r.id)
      .map((p) => p.key),
  }));
}

export function createRole(input: { name: string; description?: string; permissions: string[] }): void {
  sessionManager.ensurePermission('users.manage');
  const name = input.name.trim();
  if (!name) throw new ValidationError('Role name is required.');
  const db = getDb();
  if (db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE').get(name)) {
    throw new ValidationError('A role with this name already exists.');
  }
  tx(() => {
    const res = db.prepare('INSERT INTO roles (name, is_builtin, description, created_at) VALUES (?, 0, ?, ?)').run(
      name,
      input.description?.trim() ?? '',
      nowIso(),
    );
    const ins = db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE key = ?',
    );
    for (const key of input.permissions) ins.run(res.lastInsertRowid, key);
    audit({ action: 'role.created', entity: 'role', entityId: res.lastInsertRowid, details: { name } });
  });
}

export function updateRolePermissions(roleId: number, permissions: string[]): void {
  sessionManager.ensurePermission('users.manage');
  const db = getDb();
  const role = db.prepare('SELECT id, is_builtin FROM roles WHERE id = ?').get<{ id: number; is_builtin: number }>(roleId);
  if (!role) throw new NotFoundError('Role');
  if (role.is_builtin) throw new ValidationError('Built-in role permissions cannot be modified. Create a custom role instead.');
  tx(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const ins = db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE key = ?',
    );
    for (const key of permissions) ins.run(roleId, key);
    audit({ action: 'role.permissions_changed', entity: 'role', entityId: roleId });
  });
  sessionManager.refreshPermissions();
}

export function listPermissionsCatalog(): string[] {
  sessionManager.ensurePermission('users.view');
  return getDb()
    .prepare('SELECT key FROM permissions ORDER BY key')
    .all<{ key: string }>()
    .map((r) => r.key);
}

export function listLoginHistory(limit = 100) {
  sessionManager.ensurePermission('audit.view');
  return getDb()
    .prepare('SELECT * FROM login_events ORDER BY id DESC LIMIT ?')
    .all(limit);
}
