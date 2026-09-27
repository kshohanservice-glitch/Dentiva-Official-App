/**
 * Prescriptions with multiple medicines, clinical fields (C/C, O/E, R/E, advice),
 * Bengali/English free text, and numbered sequences.
 */
import { getDb, tx } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso } from '../../shared/datetime';
import { audit } from './audit';
import { nextSequence } from './settings';

export const MEDICINE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Cream', 'Gel', 'Drops', 'Injection', 'Other'] as const;

export interface PrescriptionItemInput {
  medicineName: string;
  medicineId?: number | null;
  form?: string;
  strength?: string;
  dose?: string;
  morning?: boolean;
  noon?: boolean;
  night?: boolean;
  beforeFood?: boolean;
  afterFood?: boolean;
  duration?: string;
  quantity?: string;
  instructions?: string;
  prn?: boolean;
  additionalInstruction?: string;
}

export interface PrescriptionInput {
  patientId: number;
  dentistId?: number | null;
  visitId?: number | null;
  chiefComplaint?: string;
  onExamination?: string;
  relevantExam?: string;
  advice?: string;
  additionalNotes?: string;
  items: PrescriptionItemInput[];
}

export function createPrescription(input: PrescriptionInput): { id: number; rxNo: string } {
  sessionManager.ensurePermission('prescriptions.create');
  const db = getDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ValidationError('Patient not found.');
  if (!Array.isArray(input.items) || input.items.length === 0) throw new ValidationError('A prescription needs at least one medicine.');
  for (const it of input.items) {
    if (!it.medicineName?.trim()) throw new ValidationError('Every medicine needs a name.');
    if (it.form && !(MEDICINE_FORMS as readonly string[]).includes(it.form)) throw new ValidationError(`Unknown medicine form "${it.form}".`);
  }

  const me = sessionManager.currentUser();
  const at = nowIso();
  let out: { id: number; rxNo: string } = { id: 0, rxNo: '' };
  tx(() => {
    const rxNo = nextSequence('next_rx_no', 'rx_prefix', 5);
    const res = db
      .prepare(
        `INSERT INTO prescriptions (rx_no, patient_id, dentist_id, visit_id, chief_complaint, on_examination, relevant_exam, advice, additional_notes, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        rxNo,
        input.patientId,
        input.dentistId ?? null,
        input.visitId ?? null,
        input.chiefComplaint?.trim() ?? '',
        input.onExamination?.trim() ?? '',
        input.relevantExam?.trim() ?? '',
        input.advice?.trim() ?? '',
        input.additionalNotes?.trim() ?? '',
        me.userId,
        at,
        at,
      );
    const rxId = res.lastInsertRowid;
    const insItem = db.prepare(
      `INSERT INTO prescription_items (prescription_id, medicine_name, medicine_id, form, strength, dose, morning, noon, night, before_food, after_food, duration, quantity, instructions, prn, additional_instruction, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.items.forEach((it, i) => {
      insItem.run(
        rxId,
        it.medicineName.trim(),
        it.medicineId ?? null,
        it.form ?? 'Tablet',
        it.strength?.trim() ?? '',
        it.dose?.trim() ?? '',
        it.morning ? 1 : 0,
        it.noon ? 1 : 0,
        it.night ? 1 : 0,
        it.beforeFood ? 1 : 0,
        it.afterFood ? 1 : 0,
        it.duration?.trim() ?? '',
        it.quantity?.trim() ?? '',
        it.instructions?.trim() ?? '',
        it.prn ? 1 : 0,
        it.additionalInstruction?.trim() ?? '',
        i,
      );
    });
    audit({ action: 'prescription.created', entity: 'prescription', entityId: rxId, details: { rxNo } });
    out = { id: rxId, rxNo };
  });
  return out;
}

export function listPrescriptions(opts: { patientId?: number; page: number; pageSize: number; search?: string }) {
  sessionManager.ensurePermission('prescriptions.view');
  const db = getDb();
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (opts.patientId) {
    where.push('p.patient_id = ?');
    params.push(opts.patientId);
  }
  if (opts.search?.trim()) {
    const s = `%${opts.search.trim()}%`;
    where.push('(p.rx_no LIKE ? OR pt.full_name LIKE ? OR pt.patient_code LIKE ?)');
    params.push(s, s, s);
  }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id WHERE ${where.join(' AND ')}`).get<{ c: number }>(...params)?.c ?? 0;
  const pageSize = Math.min(100, Math.max(10, opts.pageSize));
  const rows = db
    .prepare(
      `SELECT p.id, p.rx_no, p.created_at, p.patient_id, pt.full_name AS patient_name, pt.patient_code, d.full_name AS dentist_name,
              (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = p.id) AS medicine_count
       FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id LEFT JOIN dentists d ON d.id = p.dentist_id
       WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (Math.max(1, opts.page) - 1) * pageSize);
  return { total, rows };
}

export function getPrescription(id: number) {
  sessionManager.ensurePermission('prescriptions.view');
  const db = getDb();
  const rx = db
    .prepare(
      `SELECT p.*, pt.full_name AS patient_name, pt.patient_code, pt.age, pt.gender, pt.phone,
              d.full_name AS dentist_name, d.title AS dentist_title, d.designations AS dentist_designations, d.registration_no, d.signature_path
       FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id LEFT JOIN dentists d ON d.id = p.dentist_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get(id);
  if (!rx) throw new NotFoundError('Prescription');
  const items = db.prepare('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order ASC').all(id);
  return { ...rx, items };
}

export function voidPrescription(id: number): void {
  sessionManager.ensurePermission('prescriptions.create');
  const db = getDb();
  const rx = db.prepare('SELECT id FROM prescriptions WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!rx) throw new NotFoundError('Prescription');
  db.prepare("UPDATE prescriptions SET status = 'void', deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  audit({ action: 'prescription.voided', entity: 'prescription', entityId: id });
}

// --- medicine catalog -----------------------------------------------------------

export function medicineCatalog(term = '', limit = 200) {
  sessionManager.ensurePermission('prescriptions.view');
  const s = `%${term.trim()}%`;
  return getDb()
    .prepare(
      `SELECT id, name, generic_name, form, strength, manufacturer FROM medicines
       WHERE is_active = 1 AND (name LIKE ? OR generic_name LIKE ?) ORDER BY name ASC LIMIT ?`,
    )
    .all(s, s, limit);
}

export function upsertMedicine(input: { name: string; genericName?: string; form?: string; strength?: string; manufacturer?: string }): { id: number } {
  sessionManager.ensurePermission('prescriptions.create');
  if (!input.name?.trim()) throw new ValidationError('Medicine name is required.');
  const db = getDb();
  const existing = db.prepare('SELECT id FROM medicines WHERE name = ? COLLATE NOCASE').get<{ id: number }>(input.name.trim());
  if (existing) return { id: existing.id };
  const res = db
    .prepare('INSERT INTO medicines (name, generic_name, form, strength, manufacturer, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(input.name.trim(), input.genericName?.trim() ?? '', input.form ?? 'Tablet', input.strength?.trim() ?? '', input.manufacturer?.trim() ?? '', nowIso());
  return { id: res.lastInsertRowid };
}
