/**
 * Seed data — ONLY system-required records (roles, permissions, payment methods,
 * default categories, default settings, printer profiles). No fake clinic data.
 * Idempotent: safe to run multiple times.
 */
import type { DatabaseHandle } from './driver';
import { PERMISSIONS, ROLE_DEFAULTS, BUILTIN_ROLES } from '../../shared/permissions';
import { nowIso } from '../../shared/datetime';

export function applySeed(db: DatabaseHandle): void {
  const at = nowIso();

  // Permissions catalog
  const insPerm = db.prepare('INSERT OR IGNORE INTO permissions (key) VALUES (?)');
  for (const p of PERMISSIONS) insPerm.run(p);
  const permIds = new Map<string, number>(
    db.prepare('SELECT id, key FROM permissions').all<{ id: number; key: string }>().map((r) => [r.key, r.id]),
  );

  // Roles + grants
  const insRole = db.prepare('INSERT OR IGNORE INTO roles (name, is_builtin, description, created_at) VALUES (?, ?, ?, ?)');
  const roleDesc: Record<string, string> = {
    Admin: 'Full access to every feature, including destructive operations.',
    Dentist: 'Clinical access: patients, visits, chart, prescriptions, appointments.',
    Receptionist: 'Front-desk access: patients, appointments, queue, invoices, payments.',
    Accountant: 'Financial access: invoices, payments, accounting, reports.',
  };
  for (const r of BUILTIN_ROLES) insRole.run(r, 1, roleDesc[r] ?? '', at);

  const roles = db.prepare('SELECT id, name FROM roles').all<{ id: number; name: string }>();
  const grant = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
  for (const role of roles) {
    if (!(role.name in ROLE_DEFAULTS)) continue;
    for (const perm of ROLE_DEFAULTS[role.name as keyof typeof ROLE_DEFAULTS]) {
      const pid = permIds.get(perm);
      if (pid !== undefined) grant.run(role.id, pid);
    }
  }

  // Payment methods (Bangladesh clinic context)
  const insPm = db.prepare('INSERT OR IGNORE INTO payment_methods (name, kind, is_active, sort_order) VALUES (?, ?, 1, ?)');
  const methods: Array<[string, string]> = [
    ['Cash', 'cash'],
    ['Bank', 'bank'],
    ['Card', 'card'],
    ['bKash', 'mobile_wallet'],
    ['Nagad', 'mobile_wallet'],
    ['Rocket', 'mobile_wallet'],
    ['Upay', 'mobile_wallet'],
    ['Other', 'other'],
  ];
  methods.forEach(([name, kind], i) => insPm.run(name, kind, i));

  // Income categories
  const insIc = db.prepare('INSERT OR IGNORE INTO income_categories (name, is_system, is_active) VALUES (?, ?, 1)');
  for (const [name, sys] of [
    ['Treatment Income', 1],
    ['Consultation Fee', 1],
    ['Other Income', 0],
  ] as Array<[string, number]>) {
    insIc.run(name, sys);
  }

  // Expense categories
  const insEc = db.prepare('INSERT OR IGNORE INTO expense_categories (name, is_system, is_active) VALUES (?, ?, 1)');
  for (const [name, sys] of [
    ['Rent', 0],
    ['Electricity', 0],
    ['Internet', 0],
    ['Equipment', 0],
    ['Dental Accessories', 0],
    ['Supplies', 0],
    ['Staff Salary', 1],
    ['Maintenance', 0],
    ['Utilities', 0],
    ['Transportation', 0],
    ['Other Expense', 0],
  ] as Array<[string, number]>) {
    insEc.run(name, sys);
  }

  // Default settings
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const defaults: Record<string, string> = {
    currency: 'BDT',
    currency_symbol: '৳',
    date_format: 'DD/MM/YYYY',
    time_format: '12h',
    auto_lock_minutes: '10',
    backup_folder: '',
    auto_backup_days: '7',
    backup_retention: '10',
    invoice_prefix: 'INV-',
    receipt_prefix: 'RCP-',
    rx_prefix: 'RX-',
    patient_code_prefix: 'P-',
    next_invoice_no: '1001',
    next_receipt_no: '1001',
    next_rx_no: '1001',
    next_patient_no: '1',
    prescription_paper: 'A4',
    invoice_paper: 'A4',
    receipt_paper: 'THERMAL80',
    theme: 'light',
    density: 'comfortable',
    animations: 'on',
    sidebar_collapsed: 'false',
    low_stock_threshold_default: '5',
    expiry_warning_days: '30',
    prescription_footer_message: 'Get well soon — Dentiva Pro',
    setup_completed: 'false',
    app_locale: 'en',
  };
  for (const [k, v] of Object.entries(defaults)) insSetting.run(k, v);

  // Default printer profiles
  const insProfile = db.prepare(
    'INSERT OR IGNORE INTO printer_profiles (name, doc_type, printer_name, paper, width_mm, height_mm, margin_mm, orientation, font_scale, copies, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  insProfile.run('A4 Prescription', 'prescription', '', 'A4', 210, 297, 12, 'portrait', 1, 1, 1, at);
  insProfile.run('A5 Prescription', 'prescription', '', 'A5', 148, 210, 8, 'portrait', 0.85, 1, 0, at);
  insProfile.run('A4 Invoice', 'invoice', '', 'A4', 210, 297, 12, 'portrait', 1, 1, 1, at);
  insProfile.run('Thermal Receipt', 'receipt', '', 'THERMAL80', 80, 297, 3, 'portrait', 0.7, 1, 1, at);
  insProfile.run('A4 Report', 'report', '', 'A4', 210, 297, 12, 'portrait', 1, 1, 1, at);

  // Activation state row
  db.prepare('INSERT OR IGNORE INTO activation_state (id, activated) VALUES (1, 0)').run();
  // Clinic row placeholder (populated by setup wizard)
  db.prepare('INSERT OR IGNORE INTO clinic (id, name, created_at, updated_at) VALUES (1, ?, ?, ?)').run('', at, at);
}
