/** Typed client over the preload bridge. Every call returns data or throws ApiError. */

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
