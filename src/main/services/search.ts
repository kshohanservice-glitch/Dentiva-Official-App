/**
 * Global search across entities. Permission-filtered: financial entities are
 * only searched for users with financial permissions. Capped results per entity.
 */
import { getDb } from '../db/connection';
import { sessionManager } from './session';

export interface SearchHit {
  kind: string;
  id: number;
  title: string;
  subtitle: string;
  link: string;
}

const CAP = 8;

export function globalSearch(term: string): { hits: SearchHit[]; counts: Record<string, number> } {
  sessionManager.ensurePermission('search.use');
  const db = getDb();
  const t = term.trim();
  const hits: SearchHit[] = [];
  const counts: Record<string, number> = {};
  if (!t) return { hits, counts };
  const s = `%${t}%`;
  const perms = sessionManager.currentUser().permissions;

  // Patients (code, name, phone, emergency phone, address)
  if (perms.has('patients.view')) {
    const rows = db
      .prepare(
        `SELECT id, patient_code, full_name, phone FROM patients
         WHERE deleted_at IS NULL AND (full_name LIKE ? OR patient_code LIKE ? OR phone LIKE ? OR emergency_phone LIKE ? OR address LIKE ?)
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all<{ id: number; patient_code: string; full_name: string; phone: string }>(s, s, s, s, s, CAP);
    counts.patients = rows.length;
    for (const r of rows) hits.push({ kind: 'patient', id: r.id, title: r.full_name, subtitle: `${r.patient_code}${r.phone ? ' · ' + r.phone : ''}`, link: `patient:${r.id}` });
  }

  if (perms.has('appointments.view')) {
    const rows = db
      .prepare(
        `SELECT a.id, a.appt_date, a.start_time, p.full_name FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE (p.full_name LIKE ? OR a.appt_type LIKE ?) ORDER BY a.appt_date DESC LIMIT ?`,
      )
      .all<{ id: number; appt_date: string; start_time: string; full_name: string }>(s, s, CAP);
    counts.appointments = rows.length;
    for (const r of rows) hits.push({ kind: 'appointment', id: r.id, title: `${r.full_name} — ${r.appt_date} ${r.start_time}`, subtitle: 'Appointment', link: 'page:appointments' });
  }

  if (perms.has('clinical.view') && perms.has('prescriptions.view')) {
    const rows = db
      .prepare(
        `SELECT p.id, p.rx_no, pt.full_name FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id
         WHERE p.deleted_at IS NULL AND (p.rx_no LIKE ? OR pt.full_name LIKE ?) ORDER BY p.created_at DESC LIMIT ?`,
      )
      .all<{ id: number; rx_no: string; full_name: string }>(s, s, CAP);
    counts.prescriptions = rows.length;
    for (const r of rows) hits.push({ kind: 'prescription', id: r.id, title: `Rx ${r.rx_no}`, subtitle: r.full_name, link: 'page:prescriptions' });
  }

  if (perms.has('invoices.view')) {
    const rows = db
      .prepare(
        `SELECT i.id, i.invoice_no, pt.full_name, i.grand_total_paisa FROM invoices i JOIN patients pt ON pt.id = i.patient_id
         WHERE i.deleted_at IS NULL AND (i.invoice_no LIKE ? OR pt.full_name LIKE ?) ORDER BY i.invoice_date DESC LIMIT ?`,
      )
      .all<{ id: number; invoice_no: string; full_name: string; grand_total_paisa: number }>(s, s, CAP);
    counts.invoices = rows.length;
    for (const r of rows) hits.push({ kind: 'invoice', id: r.id, title: `Invoice ${r.invoice_no}`, subtitle: `${r.full_name} · ${(r.grand_total_paisa / 100).toFixed(2)} BDT`, link: 'page:invoices' });
  }

  if (perms.has('inventory.view')) {
    const rows = db.prepare('SELECT id, name, sku, current_stock FROM inventory_items WHERE is_active = 1 AND (name LIKE ? OR sku LIKE ? OR category LIKE ?) LIMIT ?').all<{ id: number; name: string; sku: string; current_stock: number }>(s, s, s, CAP);
    counts.inventory = rows.length;
    for (const r of rows) hits.push({ kind: 'inventory', id: r.id, title: r.name, subtitle: `${r.sku} · stock ${r.current_stock}`, link: 'page:inventory' });
  }

  if (perms.has('staff.view')) {
    const rows = db.prepare("SELECT id, name, position FROM staff WHERE deleted_at IS NULL AND (name LIKE ? OR position LIKE ? OR phone LIKE ?) LIMIT ?").all<{ id: number; name: string; position: string }>(s, s, s, CAP);
    counts.staff = rows.length;
    for (const r of rows) hits.push({ kind: 'staff', id: r.id, title: r.name, subtitle: r.position || 'Staff', link: 'page:staff-users' });
  }

  if (perms.has('treatments.view')) {
    const rows = db.prepare('SELECT id, name, code FROM treatments WHERE is_active = 1 AND (name LIKE ? OR code LIKE ? OR category LIKE ?) LIMIT ?').all<{ id: number; name: string; code: string }>(s, s, s, CAP);
    counts.treatments = rows.length;
    for (const r of rows) hits.push({ kind: 'treatment', id: r.id, title: r.name, subtitle: r.code, link: 'page:treatments' });
  }

  // Rank: patients first (most common clinic search), then by kind.
  const order: Record<string, number> = { patient: 0, appointment: 1, prescription: 2, invoice: 3, inventory: 4, staff: 5, treatment: 6 };
  hits.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  return { hits: hits.slice(0, 40), counts };
}
