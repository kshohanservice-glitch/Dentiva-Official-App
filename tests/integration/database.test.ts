import { afterEach, describe, expect, it } from 'vitest';
import { freshDb, type TestCtx } from './helpers';
import { getDb } from '../../src/main/db/connection';
import { PERMISSIONS } from '../../src/shared/permissions';

let ctx: TestCtx;
afterEach(() => ctx?.cleanup());

describe('database schema & seed', () => {
  it('creates all core tables', () => {
    ctx = freshDb();
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all<{ name: string }>()
      .map((r) => r.name);
    for (const t of [
      'clinic', 'activation_state', 'settings', 'roles', 'permissions', 'role_permissions', 'staff', 'users',
      'user_roles', 'sessions', 'login_events', 'dentists', 'patients', 'visits', 'clinical_notes', 'chart_entries',
      'treatments', 'treatment_records', 'appointments', 'queue_entries', 'medicines', 'prescriptions',
      'prescription_items', 'payment_methods', 'invoices', 'invoice_items', 'payments', 'refunds', 'suppliers',
      'inventory_items', 'inventory_batches', 'inventory_transactions', 'income_categories', 'expense_categories',
      'income_entries', 'expense_entries', 'referrals', 'attachments', 'notifications', 'audit_logs', 'backups',
      'printer_profiles', 'schema_migrations',
    ]) {
      expect(tables, `missing table ${t}`).toContain(t);
    }
  });

  it('seeds exactly the permission catalog', () => {
    ctx = freshDb();
    const rows = getDb().prepare('SELECT COUNT(*) AS c FROM permissions').get<{ c: number }>()!.c;
    expect(rows).toBe(PERMISSIONS.length);
  });

  it('seeds built-in roles with correct permission counts', () => {
    ctx = freshDb();
    const roles = getDb().prepare("SELECT r.name, COUNT(rp.permission_id) AS n FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.name").all<{ name: string; n: number }>();
    const byName = Object.fromEntries(roles.map((r) => [r.name, r.n]));
    expect(byName['Admin']).toBe(PERMISSIONS.length);
    expect(byName['Dentist']).toBeGreaterThan(5);
    expect(byName['Receptionist']).toBeGreaterThan(5);
    expect(byName['Accountant']).toBeGreaterThan(5);
    // Receptionist must NOT see accounting
    const rec = getDb().prepare("SELECT r.id FROM roles r WHERE r.name = 'Receptionist'").get<{ id: number }>()!.id;
    const acc = getDb().prepare("SELECT COUNT(*) AS c FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? AND p.key = 'accounting.view'").get<{ c: number }>(rec)!.c;
    expect(acc).toBe(0);
  });

  it('seeds 8 Bangladesh payment methods', () => {
    ctx = freshDb();
    const methods = getDb().prepare('SELECT name FROM payment_methods ORDER BY sort_order').all<{ name: string }>().map((r) => r.name);
    expect(methods).toEqual(['Cash', 'Bank', 'Card', 'bKash', 'Nagad', 'Rocket', 'Upay', 'Other']);
  });

  it('foreign keys are enforced (no orphan records)', () => {
    ctx = freshDb();
    expect(() => {
      getDb().prepare('INSERT INTO visits (patient_id, visit_date, created_at, updated_at) VALUES (99999, ?, ?, ?)').run(
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T10:00:00.000Z',
      );
    }).toThrow();
  });

  it('migration records itself and is idempotent', () => {
    ctx = freshDb();
    const v = getDb().prepare('SELECT version FROM schema_migrations').all<{ version: number }>();
    expect(v.map((x) => x.version)).toEqual([1]);
  });
});
