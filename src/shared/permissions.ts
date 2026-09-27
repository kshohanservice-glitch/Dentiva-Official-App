/**
 * Granular permission catalog — the single source of truth for RBAC.
 * Enforced in the main-process service layer (never only in UI).
 */
export const PERMISSIONS = [
  // Dashboard / general
  'dashboard.view',

  // Patients
  'patients.view',
  'patients.create',
  'patients.edit',
  'patients.delete',

  // Clinical
  'clinical.view',
  'visits.create',
  'visits.edit',
  'chart.edit',
  'treatments.view',
  'treatments.manage',

  // Prescriptions
  'prescriptions.view',
  'prescriptions.create',
  'prescriptions.print',

  // Printing / documents
  'invoices.print',
  'reports.print',

  // Appointments / queue
  'appointments.view',
  'appointments.manage',
  'queue.manage',

  // Billing
  'invoices.view',
  'invoices.create',
  'invoices.edit',
  'invoices.delete',
  'payments.view',
  'payments.record',
  'financial.view',

  // Inventory
  'inventory.view',
  'inventory.manage',

  // Accounting
  'accounting.view',
  'expenses.create',
  'expenses.edit',
  'expenses.delete',
  'income.create',
  'income.edit',
  'income.delete',
  'reports.view',

  // Staff / users
  'staff.view',
  'staff.manage',
  'users.view',
  'users.manage',
  'audit.view',

  // System
  'backup.create',
  'backup.restore',
  'settings.view',
  'settings.manage',
  'destructive.operations',
  'notifications.view',
  'search.use',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

export const BUILTIN_ROLES = ['Admin', 'Dentist', 'Receptionist', 'Accountant'] as const;
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];

/** Default permission grants for built-in roles. */
export const ROLE_DEFAULTS: Record<BuiltinRole, readonly Permission[]> = {
  Admin: ALL_PERMISSIONS,
  Dentist: [
    'dashboard.view',
    'patients.view',
    'patients.create',
    'patients.edit',
    'clinical.view',
    'visits.create',
    'visits.edit',
    'chart.edit',
    'treatments.view',
    'prescriptions.view',
    'prescriptions.create',
    'prescriptions.print',
    'appointments.view',
    'queue.manage',
    'invoices.view',
    'payments.view',
    'inventory.view',
    'staff.view',
    'search.use',
    'notifications.view',
  ],
  Receptionist: [
    'dashboard.view',
    'patients.view',
    'patients.create',
    'patients.edit',
    'clinical.view',
    'appointments.view',
    'appointments.manage',
    'queue.manage',
    'invoices.view',
    'invoices.create',
    'invoices.print',
    'payments.view',
    'payments.record',
    'inventory.view',
    'search.use',
    'notifications.view',
  ],
  Accountant: [
    'dashboard.view',
    'patients.view',
    'invoices.view',
    'invoices.create',
    'invoices.edit',
    'invoices.print',
    'payments.view',
    'payments.record',
    'financial.view',
    'inventory.view',
    'accounting.view',
    'expenses.create',
    'expenses.edit',
    'income.create',
    'income.edit',
    'reports.view',
    'reports.print',
    'search.use',
    'notifications.view',
  ],
};
