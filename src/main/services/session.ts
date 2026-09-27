/**
 * Session manager — the authoritative authentication state of the application.
 *
 * - One active session at a time (single-workstation model).
 * - Lock/unlock: while locked, every IPC call except app-state/unlock is refused.
 * - Auto-lock timer is owned HERE (main process), so the renderer cannot bypass it.
 * - Failed-login throttling with progressive lockout windows.
 */
import { getDb } from '../db/connection';
import { verifyPassword, newSessionId } from './security';
import { nowIso } from '../../shared/datetime';
import { getSettingInt, setSetting } from './settings';
import { AppError, AuthRequiredError, PermissionDeniedError } from '../util/errors';
import { logger } from '../util/logger';
import { audit } from './audit';

export interface SessionUser {
  userId: number;
  username: string;
  displayName: string;
  staffId: number | null;
  roles: string[];
  permissions: Set<string>;
}

interface SessionState {
  sessionId: string;
  user: SessionUser;
  locked: boolean;
  lastActivity: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 5;

class SessionManager {
  private state: SessionState | null = null;
  private autoLockTimer: NodeJS.Timeout | null = null;
  private onLock: (() => void) | null = null;
  private onSessionChange: (() => void) | null = null;

  setListeners(opts: { onLock?: () => void; onSessionChange?: () => void }): void {
    this.onLock = opts.onLock ?? null;
    this.onSessionChange = opts.onSessionChange ?? null;
  }

  // --- queries --------------------------------------------------------------

  currentActor(): { userId: number; username: string } | null {
    if (!this.state || this.state.locked) return null;
    return { userId: this.state.user.userId, username: this.state.user.username };
  }

  currentUser(): SessionUser {
    if (!this.state) throw new AuthRequiredError();
    return this.state.user;
  }

  hasSession(): boolean {
    return this.state !== null;
  }

  isLocked(): boolean {
    return this.state?.locked ?? false;
  }

  sessionInfo() {
    if (!this.state) return null;
    return {
      sessionId: this.state.sessionId,
      locked: this.state.locked,
      user: {
        userId: this.state.user.userId,
        username: this.state.user.username,
        displayName: this.state.user.displayName,
        roles: this.state.user.roles,
      },
    };
  }

  /** Enforce a permission at the service boundary. Throws PermissionDeniedError. */
  ensurePermission(perm: string): void {
    if (!this.state) throw new AuthRequiredError();
    if (this.state.locked) throw new AuthRequiredError('Application is locked.');
    if (!this.state.user.permissions.has(perm)) {
      logger.security('permission.denied', { user: this.state.user.username, perm });
      throw new PermissionDeniedError();
    }
  }

  touch(): void {
    if (!this.state) return;
    this.state.lastActivity = Date.now();
    this.restartAutoLockTimer();
  }

  // --- auth flows -----------------------------------------------------------

  login(username: string, password: string): SessionUser {
    const db = getDb();
    const uname = username.trim();

    // Existing session? Replace it (single session policy).
    if (this.state) this.endSessionRecord(this.state.sessionId);

    const user = db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get<{
        id: number;
        username: string;
        password_hash: string;
        salt: string;
        is_active: number;
        is_locked: number;
        failed_attempts: number;
        locked_until: string | null;
        display_name: string;
        staff_id: number | null;
      }>(uname);

    const recordFailure = (userId: number | null, reason: string): void => {
      db.prepare('INSERT INTO login_events (user_id, username_attempted, success, reason, at) VALUES (?, ?, 0, ?, ?)').run(
        userId,
        uname,
        reason,
        nowIso(),
      );
      logger.security('login.failed', { username: uname, reason });
      audit({ action: 'auth.login_failed', result: 'failure', details: { username: uname, reason } });
    };

    if (!user) {
      recordFailure(null, 'unknown-user');
      throw new AppError('AUTH_FAILED', 'Invalid username or password.');
    }
    if (!user.is_active) {
      recordFailure(user.id, 'user-disabled');
      throw new AppError('AUTH_FAILED', 'Invalid username or password.');
    }
    if (user.is_locked || (user.locked_until && user.locked_until > nowIso())) {
      recordFailure(user.id, 'user-locked');
      throw new AppError('AUTH_FAILED', 'Invalid username or password.');
    }

    const ok = verifyPassword(password, user.password_hash, user.salt);
    if (!ok) {
      const attempts = user.failed_attempts + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        const until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
        db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, until, user.id);
      } else {
        db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
      }
      recordFailure(user.id, 'bad-password');
      throw new AppError('AUTH_FAILED', 'Invalid username or password.');
    }

    const sessionId = newSessionId();
    db.prepare('INSERT INTO sessions (id, user_id, created_at, last_activity_at, locked) VALUES (?, ?, ?, ?, 0)').run(
      sessionId,
      user.id,
      nowIso(),
      nowIso(),
    );
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
    db.prepare('INSERT INTO login_events (user_id, username_attempted, success, reason, at) VALUES (?, ?, 1, ?, ?)').run(
      user.id,
      uname,
      '',
      nowIso(),
    );

    const sessUser = this.loadSessionUser(user.id, user.username, user.display_name, user.staff_id);
    this.state = { sessionId, user: sessUser, locked: false, lastActivity: Date.now() };
    this.restartAutoLockTimer();
    logger.security('login.success', { username: user.username });
    audit({ action: 'auth.login', entity: 'user', entityId: user.id });
    this.onSessionChange?.();
    return sessUser;
  }

  logout(): void {
    if (!this.state) return;
    const u = this.state.user.username;
    this.endSessionRecord(this.state.sessionId);
    audit({ action: 'auth.logout' });
    logger.security('logout', { username: u });
    this.state = null;
    this.stopAutoLockTimer();
    this.onSessionChange?.();
  }

  lock(reason: 'manual' | 'auto'): void {
    if (!this.state || this.state.locked) return;
    this.state.locked = true;
    getDb().prepare('UPDATE sessions SET locked = 1 WHERE id = ?').run(this.state.sessionId);
    audit({ action: reason === 'auto' ? 'auth.auto_lock' : 'auth.lock' });
    logger.security('app.locked', { reason, username: this.state.user.username });
    this.stopAutoLockTimer();
    this.onLock?.();
    this.onSessionChange?.();
  }

  unlock(password: string): SessionUser {
    if (!this.state) throw new AuthRequiredError('No session to unlock.');
    if (!this.state.locked) return this.state.user;
    const db = getDb();
    const user = db
      .prepare('SELECT password_hash, salt FROM users WHERE id = ?')
      .get<{ password_hash: string; salt: string }>(this.state.user.userId);
    if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
      audit({ action: 'auth.unlock_failed', result: 'failure' });
      throw new AppError('AUTH_FAILED', 'Invalid password.');
    }
    this.state.locked = false;
    this.state.lastActivity = Date.now();
    db.prepare('UPDATE sessions SET locked = 0, last_activity_at = ? WHERE id = ?').run(nowIso(), this.state.sessionId);
    audit({ action: 'auth.unlock' });
    this.restartAutoLockTimer();
    this.onSessionChange?.();
    return this.state.user;
  }

  /** Refresh cached permissions (after role/permission edits). */
  refreshPermissions(): void {
    if (!this.state) return;
    const u = this.state.user;
    this.state.user = this.loadSessionUser(u.userId, u.username, u.displayName, u.staffId);
  }

  // --- internals ------------------------------------------------------------

  private loadSessionUser(userId: number, username: string, displayName: string, staffId: number | null): SessionUser {
    const db = getDb();
    const roles = db
      .prepare(
        `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`,
      )
      .all<{ name: string }>(userId)
      .map((r) => r.name);
    const perms = db
      .prepare(
        `SELECT DISTINCT p.key FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         JOIN user_roles ur ON ur.role_id = rp.role_id
         WHERE ur.user_id = ?`,
      )
      .all<{ key: string }>(userId)
      .map((r) => r.key);
    return { userId, username, displayName, staffId, roles, permissions: new Set(perms) };
  }

  private endSessionRecord(sessionId: string): void {
    try {
      getDb().prepare('UPDATE sessions SET ended_at = ?, locked = 0 WHERE id = ?').run(nowIso(), sessionId);
    } catch {
      /* db may already be closed during shutdown */
    }
  }

  private restartAutoLockTimer(): void {
    this.stopAutoLockTimer();
    if (!this.state || this.state.locked) return;
    const minutes = getSettingInt('auto_lock_minutes', 10);
    if (minutes <= 0) return; // 0 = disabled
    this.autoLockTimer = setTimeout(() => {
      this.lock('auto');
    }, minutes * 60_000);
    this.autoLockTimer.unref?.();
  }

  private stopAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
  }
}

export const sessionManager = new SessionManager();

/** Settings helper re-export to avoid circular import surprises. */
export function setAutoLockMinutes(minutes: number): void {
  setSetting('auto_lock_minutes', String(minutes));
}
