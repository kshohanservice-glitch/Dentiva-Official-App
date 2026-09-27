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
import * as visitsSvc from '../services/visits';
import * as chartSvc from '../services/chart';
import * as timelineSvc from '../services/timeline';
import * as referralsSvc from '../services/referrals';
import * as treatmentsSvc from '../services/treatments';
import * as apptSvc from '../services/appointments';
import * as rxSvc from '../services/prescriptions';
import * as billingSvc from '../services/invoices';
import * as inventorySvc from '../services/inventory';
import * as accountingSvc from '../services/accounting';
import * as staffSvc from '../services/staff';
import * as attachmentsSvc from '../services/attachments';
import * as notificationsSvc from '../services/notifications';
import * as searchSvc from '../services/search';
import * as backupSvc from '../services/backup';
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

// --- visits & clinical -------------------------------------------------------------

register('visits:list', (patientId: unknown) => visitsSvc.listVisits(Number(patientId)));
register('visits:get', (id: unknown) => visitsSvc.getVisit(Number(id)));
register('visits:create', (input: unknown) => visitsSvc.createVisit(input as never));
register('visits:update', (id: unknown, input: unknown) => {
  visitsSvc.updateVisit(Number(id), input as never);
  return true;
});
register('visits:delete', (id: unknown) => {
  visitsSvc.softDeleteVisit(Number(id));
  return true;
});
register('visits:add-note', (patientId: unknown, note: unknown, visitId: unknown, dentistId: unknown) =>
  visitsSvc.addClinicalNote(Number(patientId), String(note), (visitId as number | null) ?? null, (dentistId as number | null) ?? null),
);
register('visits:notes', (patientId: unknown) => visitsSvc.listClinicalNotes(Number(patientId)));

// --- dental chart ------------------------------------------------------------------

register('chart:current', (patientId: unknown) => chartSvc.currentChart(Number(patientId)));
register('chart:add', (input: unknown) => chartSvc.addChartEntries(input as never));
register('chart:clear-tooth', (patientId: unknown, tooth: unknown) => {
  chartSvc.clearTooth(Number(patientId), Number(tooth));
  return true;
});
register('chart:tooth-history', (patientId: unknown, tooth: unknown) => chartSvc.toothHistory(Number(patientId), Number(tooth)));
register('chart:conditions', () => chartSvc.CHART_CONDITIONS);

// --- timeline ----------------------------------------------------------------------

register('timeline:patient', (patientId: unknown, filter: unknown) => timelineSvc.patientTimeline(Number(patientId), String(filter ?? '')));

// --- referrals ---------------------------------------------------------------------

register('referrals:create', (input: unknown) => referralsSvc.createReferral(input as never));
register('referrals:list', (patientId: unknown) => referralsSvc.listReferrals(Number(patientId)));
register('referrals:status', (id: unknown, status: unknown, outcome: unknown) => {
  referralsSvc.updateReferralStatus(Number(id), status as never, outcome as string | undefined);
  return true;
});

// --- treatments --------------------------------------------------------------------

register('treatments:list', (includeInactive: unknown, term: unknown) => treatmentsSvc.listTreatments(includeInactive === true, String(term ?? '')));
register('treatments:create', (input: unknown) => treatmentsSvc.createTreatment(input as never));
register('treatments:update', (id: unknown, input: unknown) => {
  treatmentsSvc.updateTreatment(Number(id), input as never);
  return true;
});
register('treatments:categories', () => treatmentsSvc.listCategories());
register('treatments:record', (input: unknown) => treatmentsSvc.recordTreatment(input as never));
register('treatments:records', (patientId: unknown) => treatmentsSvc.listTreatmentRecords(Number(patientId)));
register('treatments:record-status', (id: unknown, status: unknown) => {
  treatmentsSvc.updateTreatmentRecordStatus(Number(id), status as never);
  return true;
});

// --- appointments & queue -------------------------------------------------------------

register('appointments:create', (input: unknown) => apptSvc.createAppointment(input as never));
register('appointments:list', (opts: unknown) => apptSvc.listAppointments(opts as never));
register('appointments:agenda', (date: unknown, dentistId: unknown) => apptSvc.appointmentAgenda(String(date), (dentistId as number | null) ?? null));
register('appointments:status', (id: unknown, status: unknown) => {
  apptSvc.setAppointmentStatus(Number(id), status as Parameters<typeof apptSvc.setAppointmentStatus>[1]);
  return true;
});
register('appointments:reschedule', (id: unknown, date: unknown, time: unknown, dur: unknown) =>
  apptSvc.rescheduleAppointment(Number(id), String(date), String(time), dur === undefined ? undefined : Number(dur)),
);
register('appointments:cancel', (id: unknown, reason: unknown) => {
  apptSvc.cancelAppointment(Number(id), reason as string | undefined);
  return true;
});
register('appointments:month-counts', (year: unknown, month: unknown, dentistId: unknown) =>
  apptSvc.monthGridCounts(Number(year), Number(month), (dentistId as number | null) ?? null),
);
register('queue:check-in', (patientId: unknown, dentistId: unknown, apptId: unknown, priority: unknown, reason: unknown) =>
  apptSvc.checkIn(Number(patientId), (dentistId as number | null) ?? null, (apptId as number | null) ?? null, priority === true, String(reason ?? '')),
);
register('queue:list', (date: unknown) => apptSvc.queueList(date === undefined ? undefined : String(date)));
register('queue:status', (id: unknown, status: unknown) => {
  apptSvc.queueSetStatus(Number(id), status as never);
  return true;
});
register('queue:reorder', (id: unknown, pos: unknown) => {
  apptSvc.queueReorder(Number(id), Number(pos));
  return true;
});

// --- prescriptions --------------------------------------------------------------------

register('prescriptions:create', (input: unknown) => rxSvc.createPrescription(input as never));
register('prescriptions:list', (opts: unknown) => rxSvc.listPrescriptions(opts as never));
register('prescriptions:get', (id: unknown) => rxSvc.getPrescription(Number(id)));
register('prescriptions:void', (id: unknown) => {
  rxSvc.voidPrescription(Number(id));
  return true;
});
register('medicines:catalog', (term: unknown) => rxSvc.medicineCatalog(String(term ?? '')));
register('medicines:upsert', (input: unknown) => rxSvc.upsertMedicine(input as never));

// --- invoices & payments -----------------------------------------------------------------

register('invoices:create', (input: unknown) => billingSvc.createInvoice(input as never));
register('invoices:list', (opts: unknown) => billingSvc.listInvoices(opts as never));
register('invoices:get', (id: unknown) => billingSvc.getInvoice(Number(id)));
register('invoices:edit', (id: unknown, input: unknown) => {
  billingSvc.editInvoice(Number(id), input as never);
  return true;
});
register('invoices:void', (id: unknown, reason: unknown) => {
  billingSvc.voidInvoice(Number(id), String(reason));
  return true;
});
register('payments:record', (input: unknown) => billingSvc.recordPayment(input as never));
register('payments:list', (opts: unknown) => billingSvc.listPayments(opts as never));
register('payments:methods', () => billingSvc.listPaymentMethods());

// --- inventory ------------------------------------------------------------------------------

register('inventory:list', (opts: unknown) => inventorySvc.listInventory(opts as never));
register('inventory:create', (input: unknown) => inventorySvc.createInventoryItem(input as never));
register('inventory:update', (id: unknown, input: unknown) => {
  inventorySvc.updateInventoryItem(Number(id), input as never);
  return true;
});
register('inventory:retire', (id: unknown) => {
  inventorySvc.retireInventoryItem(Number(id));
  return true;
});
register('inventory:move', (input: unknown) => {
  inventorySvc.stockMovement(input as never);
  return true;
});
register('inventory:ledger', (itemId: unknown) => inventorySvc.stockLedger(Number(itemId)));
register('inventory:alerts', () => inventorySvc.inventoryAlerts());
register('suppliers:list', () => inventorySvc.listSuppliers());
register('suppliers:upsert', (input: unknown) => inventorySvc.upsertSupplier(input as never));

// --- accounting ------------------------------------------------------------------------------

register('accounting:add-income', (input: unknown) => accountingSvc.addIncome(input as never));
register('accounting:add-expense', (input: unknown) => accountingSvc.addExpense(input as never));
register('accounting:list', (kind: unknown, opts: unknown) => accountingSvc.listEntries(kind === 'income' ? 'income' : 'expense', opts as never));
register('accounting:update', (kind: unknown, id: unknown, input: unknown) => {
  accountingSvc.updateEntry(kind === 'income' ? 'income' : 'expense', Number(id), input as never);
  return true;
});
register('accounting:delete', (kind: unknown, id: unknown) => {
  accountingSvc.deleteEntry(kind === 'income' ? 'income' : 'expense', Number(id));
  return true;
});
register('accounting:categories', (kind: unknown) => accountingSvc.listCategories(kind === 'income' ? 'income' : 'expense'));
register('accounting:add-category', (kind: unknown, name: unknown) => accountingSvc.addCategory(kind === 'income' ? 'income' : 'expense', String(name)));
register('accounting:report', (range: unknown) => accountingSvc.accountingReport(range as never));

// --- staff -----------------------------------------------------------------------------------

register('staff:list', (includeInactive: unknown) => staffSvc.listStaff(includeInactive === true));
register('staff:get', (id: unknown) => staffSvc.getStaffMember(Number(id)));
register('staff:create', (input: unknown) => staffSvc.createStaff(input as never));
register('staff:update', (id: unknown, input: unknown) => {
  staffSvc.updateStaff(Number(id), input as never);
  return true;
});
register('staff:delete', (id: unknown) => {
  staffSvc.softDeleteStaff(Number(id));
  return true;
});

// --- attachments -------------------------------------------------------------------------------

register('attachments:add', (opts: unknown) => attachmentsSvc.addAttachment(opts as never));
register('attachments:list', (entityType: unknown, entityId: unknown) => attachmentsSvc.listAttachments(String(entityType), Number(entityId)));
register('attachments:read', (id: unknown) => attachmentsSvc.readAttachment(Number(id)));
register('attachments:delete', (id: unknown) => {
  attachmentsSvc.deleteAttachment(Number(id));
  return true;
});

// --- notifications -------------------------------------------------------------------------------

register('notifications:list', (unreadOnly: unknown) => notificationsSvc.listNotifications(unreadOnly === true));
register('notifications:unread', () => notificationsSvc.unreadCount());
register('notifications:read', (id: unknown) => {
  notificationsSvc.markRead(Number(id));
  return true;
});
register('notifications:read-all', () => {
  notificationsSvc.markAllRead();
  return true;
});
register('notifications:refresh', () => {
  notificationsSvc.refreshAlertNotifications();
  return notificationsSvc.unreadCount();
});

// --- search -----------------------------------------------------------------------------------------

register('search:global', (term: unknown) => searchSvc.globalSearch(String(term ?? '')));

// --- backup & restore ---------------------------------------------------------------------------------

register('backup:create', () => backupSvc.createBackup('manual'));
register('backup:list', () => backupSvc.listBackups());
register('backup:restore', (zipPath: unknown, confirmation: unknown) => backupSvc.restoreBackup(String(zipPath), String(confirmation)));
register('backup:validate', (zipPath: unknown) => backupSvc.validateBackupFile(String(zipPath)));
register('backup:folder', () => backupSvc.backupFolder());

// --- wire-up ----------------------------------------------------------------------

export function registerIpcHandlers(): void {
  for (const [channel, handler] of channels) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        if (sessionManager.isLocked() && !ALWAYS_ALLOWED.has(channel)) {
          return { ok: false, error: { code: 'LOCKED', message: 'Application is locked.' } };
        }
        const data = await Promise.resolve(handler(...args));
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
