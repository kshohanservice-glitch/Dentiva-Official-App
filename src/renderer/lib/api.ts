/** Typed client over the preload bridge. Every call returns data or throws ApiError. */
import type {
  AccountingReport, AppointmentRow, AttachmentRow, BackupRow, Category, ChartData, InvoiceFull, InvoiceRow, InventoryRow, NotificationRow, PaymentsPage, PaymentMethod, PrescriptionFull, PrescriptionRow, QueueRow, SearchHit, StaffRow, TimelineEvent, TreatmentRow, VisitRow,
} from './types-extra';

export * from './types-extra';

declare global {
  interface Window {
    dentiva: {
      invoke: (channel: string, ...args: unknown[]) => Promise<IpcResult>;
      on: (channel: string, cb: (payload: unknown) => void) => () => void;
      versions: { electron: string; chrome: string; node: string };
    };
  }
}

export interface IpcResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await window.dentiva.invoke(channel, ...args);
  if (!res.ok) throw new ApiError(res.error?.code ?? 'INTERNAL', res.error?.message ?? 'Something went wrong.');
  return res.data as T;
}

export const api = {
  appState: () => call<AppState>('app:state'),
  version: () => call<{ version: string; build: string }>('app:version'),
  activity: () => call<boolean>('app:activity').catch(() => false),
  lock: () => call<boolean>('app:lock'),
  unlock: (password: string) => call<SessionInfo | null>('app:unlock', password),
  logout: () => call<boolean>('app:logout'),

  activationStatus: () => call<{ activated: boolean; activatedAt: string | null }>('activation:status'),
  activate: (code: string) => call<{ activated: boolean }>('activation:activate', code),

  setupStatus: () => call<{ setupCompleted: boolean; hasUsers: boolean }>('setup:status'),
  setupComplete: (input: unknown) => call<{ setupCompleted: boolean }>('setup:complete', input),

  login: (username: string, password: string) => call<{ user: SessionInfo }>('auth:login', username, password),
  changePassword: (current: string, next: string) => call<boolean>('auth:change-password', current, next),
  loginHistory: () => call<unknown[]>('auth:login-history'),

  clinicGet: () => call<Clinic | null>('clinic:get'),
  clinicUpdate: (patch: Partial<ClinicInput>) => call<Clinic>('clinic:update', patch),

  dentistsList: (includeInactive = false) => call<Dentist[]>('dentists:list', includeInactive),
  dentistCreate: (input: Partial<Dentist>) => call<{ id: number }>('dentists:create', input),
  dentistUpdate: (id: number, input: Partial<Dentist>) => call<boolean>('dentists:update', id, input),
  dentistDelete: (id: number) => call<boolean>('dentists:delete', id),

  settingsAll: () => call<Record<string, string>>('settings:get-all'),
  settingSet: (key: string, value: string) => call<boolean>('settings:set', key, value),

  usersList: () => call<AppUser[]>('users:list'),
  userCreate: (input: unknown) => call<AppUser>('users:create', input),
  userSetActive: (id: number, active: boolean) => call<boolean>('users:set-active', id, active),
  userSetLocked: (id: number, locked: boolean) => call<boolean>('users:set-locked', id, locked),
  userResetPassword: (id: number, pw: string) => call<boolean>('users:reset-password', id, pw),
  userAssignRoles: (id: number, roleIds: number[]) => call<boolean>('users:assign-roles', id, roleIds),
  rolesList: () => call<Role[]>('roles:list'),
  roleCreate: (input: unknown) => call<boolean>('roles:create', input),
  roleUpdatePermissions: (id: number, perms: string[]) => call<boolean>('roles:update-permissions', id, perms),
  permissionsCatalog: () => call<string[]>('permissions:catalog'),

  patientsList: (q: unknown) => call<PatientPage>('patients:list', q),
  patientGet: (id: number) => call<PatientFull>('patients:get', id),
  patientCreate: (input: unknown) => call<{ id: number; patientCode: string }>('patients:create', input),
  patientUpdate: (id: number, input: unknown) => call<PatientFull>('patients:update', id, input),
  patientDelete: (id: number, confirmation: string) => call<boolean>('patients:delete', id, confirmation),
  patientSetPinned: (id: number, pinned: boolean) => call<boolean>('patients:set-pinned', id, pinned),
  patientSetStatus: (id: number, status: string) => call<boolean>('patients:set-status', id, status),
  patientFinancials: (id: number) => call<unknown>('patients:financial-history', id),
  patientsPicker: (term: string) => call<Array<{ id: number; patient_code: string; full_name: string; phone: string }>>('patients:search-picker', term),

  auditQuery: (q: unknown) => call<{ total: number; rows: unknown[] }>('audit:query', q),

  callDashboard: () => call<Record<string, unknown>>('dashboard:stats'),

  // visits & clinical
  visitsList: (patientId: number) => call<VisitRow[]>('visits:list', patientId),
  visitGet: (id: number) => call<VisitRow>('visits:get', id),
  visitCreate: (input: unknown) => call<{ id: number }>('visits:create', input),
  visitUpdate: (id: number, input: unknown) => call<boolean>('visits:update', id, input),
  visitDelete: (id: number) => call<boolean>('visits:delete', id),
  visitAddNote: (patientId: number, note: string, visitId?: number | null, dentistId?: number | null) =>
    call<{ id: number }>('visits:add-note', patientId, note, visitId, dentistId),
  visitNotes: (patientId: number) => call<unknown[]>('visits:notes', patientId),

  // chart
  chartCurrent: (patientId: number) => call<ChartData>('chart:current', patientId),
  chartAdd: (input: unknown) => call<{ created: number }>('chart:add', input),
  chartClearTooth: (patientId: number, tooth: number) => call<boolean>('chart:clear-tooth', patientId, tooth),
  chartToothHistory: (patientId: number, tooth: number) => call<unknown[]>('chart:tooth-history', patientId, tooth),
  chartConditions: () => call<string[]>('chart:conditions'),

  timeline: (patientId: number, filter = '') => call<TimelineEvent[]>('timeline:patient', patientId, filter),

  // referrals
  referralCreate: (input: unknown) => call<{ id: number }>('referrals:create', input),
  referralsList: (patientId: number) => call<unknown[]>('referrals:list', patientId),
  referralStatus: (id: number, status: string, outcome?: string) => call<boolean>('referrals:status', id, status, outcome),

  // treatments
  treatmentsList: (includeInactive = false, term = '') => call<TreatmentRow[]>('treatments:list', includeInactive, term),
  treatmentCreate: (input: unknown) => call<{ id: number }>('treatments:create', input),
  treatmentUpdate: (id: number, input: unknown) => call<boolean>('treatments:update', id, input),
  treatmentCategories: () => call<string[]>('treatments:categories'),
  treatmentRecord: (input: unknown) => call<{ id: number; pricePaisa: number }>('treatments:record', input),
  treatmentRecords: (patientId: number) => call<unknown[]>('treatments:records', patientId),
  treatmentRecordStatus: (id: number, status: string) => call<boolean>('treatments:record-status', id, status),

  // appointments & queue
  apptCreate: (input: unknown) => call<{ id: number; conflict: boolean }>('appointments:create', input),
  apptList: (opts: unknown) => call<AppointmentRow[]>('appointments:list', opts),
  apptAgenda: (date: string, dentistId?: number | null) => call<AppointmentRow[]>('appointments:agenda', date, dentistId),
  apptStatus: (id: number, status: string) => call<boolean>('appointments:status', id, status),
  apptReschedule: (id: number, date: string, time: string, dur?: number) => call<{ conflict: boolean }>('appointments:reschedule', id, date, time, dur),
  apptCancel: (id: number, reason?: string) => call<boolean>('appointments:cancel', id, reason),
  queueCheckIn: (patientId: number, dentistId?: number | null, apptId?: number | null, priority?: boolean, reason?: string) =>
    call<{ id: number; queueNo: number }>('queue:check-in', patientId, dentistId, apptId, priority, reason),
  queueList: (date?: string) => call<QueueRow[]>('queue:list', date),
  queueStatus: (id: number, status: string) => call<boolean>('queue:status', id, status),

  // prescriptions
  rxCreate: (input: unknown) => call<{ id: number; rxNo: string }>('prescriptions:create', input),
  rxList: (opts: unknown) => call<{ total: number; rows: PrescriptionRow[] }>('prescriptions:list', opts),
  rxGet: (id: number) => call<PrescriptionFull>('prescriptions:get', id),
  rxVoid: (id: number) => call<boolean>('prescriptions:void', id),
  medicinesCatalog: (term = '') => call<unknown[]>('medicines:catalog', term),
  medicineUpsert: (input: unknown) => call<{ id: number }>('medicines:upsert', input),

  // invoices & payments
  invoiceCreate: (input: unknown) => call<{ id: number; invoiceNo: string; grandTotalPaisa: number }>('invoices:create', input),
  invoiceList: (opts: unknown) => call<{ total: number; rows: InvoiceRow[] }>('invoices:list', opts),
  invoiceGet: (id: number) => call<InvoiceFull>('invoices:get', id),
  invoiceVoid: (id: number, reason: string) => call<boolean>('invoices:void', id, reason),
  paymentRecord: (input: unknown) => call<{ id: number; receiptNo: string; invoiceStatus: string }>('payments:record', input),
  paymentsList: (opts: unknown) => call<PaymentsPage>('payments:list', opts),
  paymentMethods: () => call<PaymentMethod[]>('payments:methods'),

  // inventory
  inventoryList: (opts: unknown) => call<InventoryRow[]>('inventory:list', opts),
  inventoryCreate: (input: unknown) => call<{ id: number }>('inventory:create', input),
  inventoryUpdate: (id: number, input: unknown) => call<boolean>('inventory:update', id, input),
  inventoryRetire: (id: number) => call<boolean>('inventory:retire', id),
  inventoryMove: (input: unknown) => call<boolean>('inventory:move', input),
  inventoryLedger: (itemId: number) => call<unknown[]>('inventory:ledger', itemId),
  inventoryAlerts: () => call<{ low: unknown[]; out: unknown[]; expiring: unknown[]; expired: unknown[] }>('inventory:alerts'),
  suppliersList: () => call<unknown[]>('suppliers:list'),
  supplierUpsert: (input: unknown) => call<{ id: number }>('suppliers:upsert', input),

  // accounting
  accountingAddIncome: (input: unknown) => call<{ id: number }>('accounting:add-income', input),
  accountingAddExpense: (input: unknown) => call<{ id: number }>('accounting:add-expense', input),
  accountingList: (kind: 'income' | 'expense', opts: unknown) => call<{ total: number; rows: unknown[] }>('accounting:list', kind, opts),
  accountingUpdate: (kind: string, id: number, input: unknown) => call<boolean>('accounting:update', kind, id, input),
  accountingDelete: (kind: string, id: number) => call<boolean>('accounting:delete', kind, id),
  accountingCategories: (kind: 'income' | 'expense') => call<Category[]>('accounting:categories', kind),
  accountingAddCategory: (kind: string, name: string) => call<{ id: number }>('accounting:add-category', kind, name),
  accountingReport: (range: unknown) => call<AccountingReport>('accounting:report', range),

  // staff
  staffList: (includeInactive = false) => call<StaffRow[]>('staff:list', includeInactive),
  staffGet: (id: number) => call<StaffRow>('staff:get', id),
  staffCreate: (input: unknown) => call<{ id: number }>('staff:create', input),
  staffUpdate: (id: number, input: unknown) => call<boolean>('staff:update', id, input),
  staffDelete: (id: number) => call<boolean>('staff:delete', id),

  // attachments
  attachmentAdd: (opts: unknown) => call<{ id: number; storedName: string }>('attachments:add', opts),
  attachmentsList: (entityType: string, entityId: number) => call<AttachmentRow[]>('attachments:list', entityType, entityId),
  attachmentRead: (id: number) => call<{ fileName: string; dataBase64: string; mimeType: string }>('attachments:read', id),
  attachmentDelete: (id: number) => call<boolean>('attachments:delete', id),

  // notifications
  notificationsList: (unreadOnly = false) => call<NotificationRow[]>('notifications:list', unreadOnly),
  notificationsUnread: () => call<number>('notifications:unread'),
  notificationRead: (id: number) => call<boolean>('notifications:read', id),
  notificationsReadAll: () => call<boolean>('notifications:read-all'),
  notificationsRefresh: () => call<number>('notifications:refresh'),

  // search
  searchGlobal: (term: string) => call<{ hits: SearchHit[]; counts: Record<string, number> }>('search:global', term),

  // backup
  backupCreate: () => call<{ id: number; filePath: string; sizeBytes: number }>('backup:create'),
  backupList: () => call<BackupRow[]>('backup:list'),
  backupRestore: (zipPath: string, confirmation: string) => call<{ restored: string }>('backup:restore', zipPath, confirmation),
  backupFolder: () => call<string>('backup:folder'),
};

// --- shared view models --------------------------------------------------------

export interface AppState {
  activated: boolean;
  setupCompleted: boolean;
  hasUsers: boolean;
  session: SessionInfo | null;
  locked: boolean;
  clinic: Clinic | null;
}

export interface SessionInfo {
  sessionId: string;
  locked: boolean;
  user: { userId: number; username: string; displayName: string; roles: string[] };
}

export interface Clinic {
  id: number;
  name: string;
  logoPath: string | null;
  address: string;
  phone: string;
  email: string;
  website: string;
  extraContact: string;
  tagline: string;
  businessHours: string;
  workingDays: string[];
}

export interface ClinicInput {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  extraContact: string;
  tagline: string;
  businessHours: string;
  workingDays: string[];
}

export interface Dentist {
  id: number;
  full_name: string;
  title: string;
  designations: string;
  registration_no: string;
  phone: string;
  email: string;
  signature_path: string | null;
  photo_path: string | null;
  consultation_hours: string;
  status: 'active' | 'inactive';
  sort_order: number;
}

export interface AppUser {
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

export interface Role {
  id: number;
  name: string;
  is_builtin: number;
  description: string;
  permissions: string[];
}

export interface PatientRow {
  id: number;
  patient_code: string;
  full_name: string;
  age: number | null;
  gender: string;
  blood_group: string;
  address: string;
  phone: string;
  emergency_phone: string;
  present_complaint: string;
  status: string;
  is_pinned: number;
  photo_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientPage {
  total: number;
  page: number;
  pageSize: number;
  rows: PatientRow[];
}

export interface PatientFull extends PatientRow {
  past_history: string;
  notes: string;
  identifier: string;
  summary: {
    totalVisits: number;
    lastVisit: string | null;
    nextAppointment: { date: string; time: string } | null;
    totalBilledPaisa: number;
    totalPaidPaisa: number;
    outstandingPaisa: number;
    prescriptions: number;
    treatments: number;
  };
}
