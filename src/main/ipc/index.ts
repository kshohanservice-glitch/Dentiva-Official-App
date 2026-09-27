/**
 * IPC registry. Every channel validates input and returns { ok, data } or { ok:false, error }.
 * Permission enforcement happens inside services; this layer maps errors safely.
 */
import { ipcMain } from 'electron';
import { toSafeError } from '../util/errors';
import { sessionManager } from '../services/session';
import { isActivated, activate, activationStatus } from '../services/activation';
import { completeSetup, setupStatus, updateClinicInfo, getClinic, type SetupInput } from '../services/setup';
import { setSetting, getAllSettings } from '../services/settings';
import {
  listUsers, createUser, setUserActive, setUserLocked, resetUserPassword, assignUserRoles,
  changeOwnPassword, listRoles, createRole, updateRolePermissions, listPermissionsCatalog, listLoginHistory,
} from '../services/users';
import {
  listPatients, getPatient, createPatient, updatePatient, deletePatient, setPatientPinned,
  setPatientStatus, patientFinancialHistory, searchPatientsForPicker,
} from '../services/patients';
import { listDentists, createDentist, updateDentist, softDeleteDentist } from '../services/dentists';
import { queryAuditLogs } from '../services/audit';
import { dashboardStats } from '../services/dashboard';
import { logger } from '../util/logger';
import { APP_VERSION, APP_BUILD } from '../version';

type Handler = (...args: never[]) => unknown;

const channels = new Map<string, (...args: unknown[]) => unknown>();

function register(channel: string, handler: Handler): void {
  channels.set(channel, handler as (...args: unknown[]) => unknown);
}

/** Channels allowed while the app is locked (or before activation/setup). */
const ALWAYS_ALLOWED = new Set([
  'app:state',
  'app:version',
  'app:unlock',
  'app:lock',
  'activation:status',
  'activation:activate',
  'setup:status',
  'setup:complete',
  'auth:login',
]);

// --- app ---------------------------------------------------------------------

register('app:version', () => ({ version: APP_VERSION, build: APP_BUILD }));

register('app:state', () => {
  const activated = isActivated();
  const setup = setupStatus();
  const session = sessionManager.sessionInfo();
  return {
    activated,
    setupCompleted: setup.setupCompleted,
    hasUsers: setup.hasUsers,
    session,
    locked: sessionManager.isLocked(),
    clinic: activated && setup.setupCompleted ? getClinic() : null,
  };
});

register('app:activity', () => {
  sessionManager.touch();
  return true;
});

register('app:lock', () => {
  sessionManager.lock('manual');
  return true;
});

register('app:unlock', (password: unknown) => {
  if (typeof password !== 'string') throw new Error('Password required');
  sessionManager.unlock(password);
  return sessionManager.sessionInfo();
});

register('app:logout', () => {
  sessionManager.logout();
  return true;
});

// --- activation ---------------------------------------------------------------

register('activation:status', () => activationStatus());
register('activation:activate', (code: unknown) => {
  if (typeof code !== 'string') throw new Error('Activation code required');
  activate(code);
  return activationStatus();
});

// --- setup --------------------------------------------------------------------

register('setup:status', () => setupStatus());
register('setup:complete', (input: unknown) => {
  completeSetup(input as SetupInput);
  return setupStatus();
});

// --- auth ---------------------------------------------------------------------

register('auth:login', (username: unknown, password: unknown) => {
  if (typeof username !== 'string' || typeof password !== 'string') throw new Error('Username and password required');
  sessionManager.login(username, password);
  return { user: sessionManager.sessionInfo() };
});

register('auth:change-password', (current: unknown, next: unknown) => {
  if (typeof current !== 'string' || typeof next !== 'string') throw new Error('Passwords required');
  changeOwnPassword(current, next);
  return true;
});

// --- clinic & dentists ----------------------------------------------------------

register('clinic:get', () => getClinic());
register('clinic:update', (patch: unknown) => {
  sessionManager.ensurePermission('settings.manage');
  updateClinicInfo(patch as Parameters<typeof updateClinicInfo>[0]);
  return getClinic();
});

register('dentists:list', (includeInactive: unknown) => listDentists(includeInactive === true));
register('dentists:create', (input: unknown) => createDentist(input as never));
register('dentists:update', (id: unknown, input: unknown) => {
  updateDentist(Number(id), input as never);
  return true;
});
register('dentists:delete', (id: unknown) => {
  softDeleteDentist(Number(id));
  return true;
});

// --- settings -------------------------------------------------------------------

register('settings:get-all', () => {
  sessionManager.ensurePermission('settings.view');
  return getAllSettings();
});
register('settings:set', (key: unknown, value: unknown) => {
  sessionManager.ensurePermission('settings.manage');
  if (typeof key !== 'string' || typeof value !== 'string') throw new Error('Invalid setting');
  const ALLOWED = new Set([
    'currency', 'currency_symbol', 'date_format', 'time_format', 'auto_lock_minutes',
    'backup_folder', 'auto_backup_days', 'backup_retention', 'invoice_prefix', 'receipt_prefix',
    'rx_prefix', 'patient_code_prefix', 'prescription_paper', 'invoice_paper', 'receipt_paper',
    'theme', 'density', 'animations', 'sidebar_collapsed', 'low_stock_threshold_default',
    'expiry_warning_days', 'prescription_footer_message', 'app_locale',
  ]);
  if (!ALLOWED.has(key)) throw new Error('Unknown setting');
  setSetting(key, value);
  return true;
});

// --- users & roles ----------------------------------------------------------------

register('users:list', () => listUsers());
register('users:create', (input: unknown) => createUser(input as never));
register('users:set-active', (id: unknown, active: unknown) => {
  setUserActive(Number(id), active === true);
  return true;
});
register('users:set-locked', (id: unknown, locked: unknown) => {
  setUserLocked(Number(id), locked === true);
  return true;
});
register('users:reset-password', (id: unknown, pw: unknown) => {
  resetUserPassword(Number(id), String(pw));
  return true;
});
register('users:assign-roles', (id: unknown, roleIds: unknown) => {
  assignUserRoles(Number(id), (roleIds as number[]).map(Number));
  return true;
});
register('roles:list', () => listRoles());
register('roles:create', (input: unknown) => {
  createRole(input as never);
  return true;
});
register('roles:update-permissions', (id: unknown, perms: unknown) => {
  updateRolePermissions(Number(id), perms as string[]);
  return true;
});
register('permissions:catalog', () => listPermissionsCatalog());
register('auth:login-history', () => listLoginHistory(200));

// --- patients ---------------------------------------------------------------------

register('patients:list', (q: unknown) => listPatients(q as never));
register('patients:get', (id: unknown) => getPatient(Number(id)));
register('patients:create', (input: unknown) => createPatient(input as never));
register('patients:update', (id: unknown, input: unknown) => {
  updatePatient(Number(id), input as never);
  return getPatient(Number(id));
});
register('patients:delete', (id: unknown, confirmation: unknown) => {
  deletePatient(Number(id), String(confirmation ?? ''));
  return true;
});
register('patients:set-pinned', (id: unknown, pinned: unknown) => {
  setPatientPinned(Number(id), pinned === true);
  return true;
});
register('patients:set-status', (id: unknown, status: unknown) => {
  setPatientStatus(Number(id), status as never);
  return true;
});
register('patients:financial-history', (id: unknown) => patientFinancialHistory(Number(id)));
register('patients:search-picker', (term: unknown) => searchPatientsForPicker(String(term ?? '')));

// --- dashboard ----------------------------------------------------------------------

register('dashboard:stats', () => dashboardStats());

// --- audit ------------------------------------------------------------------------

register('audit:query', (q: unknown) => {
  sessionManager.ensurePermission('audit.view');
  return queryAuditLogs(q as never);
});

// --- wire-up ----------------------------------------------------------------------

export function registerIpcHandlers(): void {
  for (const [channel, handler] of channels) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        if (sessionManager.isLocked() && !ALWAYS_ALLOWED.has(channel)) {
          return { ok: false, error: { code: 'LOCKED', message: 'Application is locked.' } };
        }
        const data = handler(...args);
        return { ok: true, data };
      } catch (err) {
        const safe = toSafeError(err);
        if (safe.code === 'INTERNAL') {
          logger.error('ipc.error', { channel, message: safe.message, stack: err instanceof Error ? err.stack : undefined });
        }
        return { ok: false, error: safe };
      }
    });
  }
}

export function listRegisteredChannels(): string[] {
  return [...channels.keys()];
}

export const APP_INFO = { name: 'Dentiva Pro', version: APP_VERSION, build: APP_BUILD };
