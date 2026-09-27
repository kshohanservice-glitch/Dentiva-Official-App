/**
 * Patient management. Codes unique, soft deletion, paginated lists, filters.
 */
import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError, AppError } from '../util/errors';
import { nowIso, rangeForPreset } from '../../shared/datetime';
import { audit } from './audit';
import { nextSequence } from './settings';

export interface PatientInput {
  fullName: string;
  patientCode?: string;
  age?: number | null;
  gender?: string;
  bloodGroup?: string;
  address?: string;
  phone?: string;
  emergencyPhone?: string;
  presentComplaint?: string;
  pastHistory?: string;
  notes?: string;
  identifier?: string;
}

const GENDERS = new Set(['', 'male', 'female', 'other']);

function validatePatient(input: PatientInput): void {
  if (!input.fullName?.trim()) throw new ValidationError('Patient name is required.');
  if (input.fullName.trim().length > 120) throw new ValidationError('Patient name is too long.');
  if (!GENDERS.has(input.gender ?? '')) throw new ValidationError('Gender is not valid.');
  if (input.age !== undefined && input.age !== null) {
    if (!Number.isInteger(input.age) || input.age < 0 || input.age > 130) {
      throw new ValidationError('Age must be between 0 and 130.');
    }
  }
  for (const phone of [input.phone, input.emergencyPhone]) {
    if (phone && !/^[+\d][\d\s\-()]{3,19}$/.test(phone)) {
      throw new ValidationError('Phone number is not valid.');
    }
  }
}

export function createPatient(input: PatientInput): { id: number; patientCode: string } {
  sessionManager.ensurePermission('patients.create');
  validatePatient(input);
  const db = getDb();
  const me = sessionManager.currentUser();

  let code = input.patientCode?.trim();
  if (code) {
    if (db.prepare('SELECT id FROM patients WHERE patient_code = ?').get(code)) {
      throw new ValidationError(`Patient code "${code}" is already in use.`);
    }
  } else {
    code = nextSequence('next_patient_no', 'patient_code_prefix', 6);
  }

  // Duplicate hint: same full name AND same phone already exists → reject (safeguard).
  if (input.phone?.trim()) {
    const dup = db
      .prepare('SELECT id, patient_code FROM patients WHERE full_name = ? COLLATE NOCASE AND phone = ? AND deleted_at IS NULL')
      .get<{ id: number; patient_code: string }>(input.fullName.trim(), input.phone.trim());
    if (dup) {
      throw new ValidationError(`A patient with the same name and phone already exists (${dup.patient_code}). Open that record or use a different phone.`);
    }
  }

  const at = nowIso();
  const res = db
    .prepare(
      `INSERT INTO patients (patient_code, full_name, age, gender, blood_group, address, phone, emergency_phone,
        present_complaint, past_history, notes, identifier, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(
      code,
      input.fullName.trim(),
      input.age ?? null,
      input.gender ?? '',
      input.bloodGroup ?? '',
      input.address?.trim() ?? '',
      input.phone?.trim() ?? '',
      input.emergencyPhone?.trim() ?? '',
      input.presentComplaint?.trim() ?? '',
      input.pastHistory?.trim() ?? '',
      input.notes?.trim() ?? '',
      input.identifier?.trim() ?? '',
      me.userId,
      at,
      at,
    );
  audit({ action: 'patient.created', entity: 'patient', entityId: res.lastInsertRowid, details: { code } });
  return { id: res.lastInsertRowid, patientCode: code };
}

export interface PatientListQuery {
  search?: string;
  preset?: 'today' | '7d' | '30d' | '90d' | '1y' | 'all' | 'custom';
  customFrom?: string;
  customTo?: string;
  status?: string;
  page: number;
  pageSize: number;
}

export function listPatients(q: PatientListQuery) {
  sessionManager.ensurePermission('patients.view');
  const db = getDb();
  const where: string[] = ['deleted_at IS NULL'];
  const params: (string | number)[] = [];

  if (q.search?.trim()) {
    const s = `%${q.search.trim()}%`;
    where.push('(full_name LIKE ? OR patient_code LIKE ? OR phone LIKE ? OR emergency_phone LIKE ? OR address LIKE ? OR identifier LIKE ?)');
    params.push(s, s, s, s, s, s);
  }
  if (q.status && q.status !== 'all') {
    where.push('status = ?');
    params.push(q.status);
  }
  if (q.preset && q.preset !== 'all') {
    const range = rangeForPreset(q.preset, { from: q.customFrom ?? '', to: q.customTo ?? '' });
    if (range) {
      where.push('created_at >= ? AND created_at <= ?');
      params.push(range.from, range.to);
    }
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS c FROM patients ${whereSql}`).get<{ c: number }>(...params)?.c ?? 0;
  const page = Math.max(1, q.page);
  const pageSize = Math.min(200, Math.max(10, q.pageSize));
  const rows = db
    .prepare(
      `SELECT id, patient_code, full_name, age, gender, blood_group, address, phone, emergency_phone,
              present_complaint, status, is_pinned, photo_path, created_at, updated_at
       FROM patients ${whereSql}
       ORDER BY is_pinned DESC, created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize);
  return { total, page, pageSize, rows };
}

export function getPatient(id: number) {
  sessionManager.ensurePermission('patients.view');
  const db = getDb();
  const p = db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL').get<Record<string, unknown>>(id);
  if (!p) throw new NotFoundError('Patient');

  const visits = db.prepare('SELECT COUNT(*) AS c FROM visits WHERE patient_id = ? AND deleted_at IS NULL').get<{ c: number }>(id)?.c ?? 0;
  const lastVisit = db
    .prepare('SELECT visit_date FROM visits WHERE patient_id = ? AND deleted_at IS NULL ORDER BY visit_date DESC LIMIT 1')
    .get<{ visit_date: string }>(id)?.visit_date ?? null;
  const nextAppt = db
    .prepare(
      `SELECT appt_date, start_time FROM appointments
       WHERE patient_id = ? AND status IN ('scheduled','confirmed','arrived','in-queue','in-progress','rescheduled')
         AND appt_date >= date('now')
       ORDER BY appt_date ASC, start_time ASC LIMIT 1`,
    )
    .get<{ appt_date: string; start_time: string }>(id) ?? null;

  const fin = db
    .prepare(
      `SELECT COALESCE(SUM(grand_total_paisa),0) AS billed, COALESCE(SUM(paid_paisa),0) AS paid
       FROM invoices WHERE patient_id = ? AND status != 'void' AND deleted_at IS NULL`,
    )
    .get<{ billed: number; paid: number }>(id)!;
  const rxCount = db.prepare('SELECT COUNT(*) AS c FROM prescriptions WHERE patient_id = ? AND deleted_at IS NULL').get<{ c: number }>(id)?.c ?? 0;
  const txCount = db.prepare('SELECT COUNT(*) AS c FROM treatment_records WHERE patient_id = ?').get<{ c: number }>(id)?.c ?? 0;

  const result: Record<string, unknown> & { summary: Record<string, unknown> } = {
    ...p,
    summary: {
      totalVisits: visits,
      lastVisit,
      nextAppointment: nextAppt ? { date: nextAppt.appt_date, time: nextAppt.start_time } : null,
      totalBilledPaisa: fin.billed,
      totalPaidPaisa: fin.paid,
      outstandingPaisa: fin.billed - fin.paid,
      prescriptions: rxCount,
      treatments: txCount,
    },
  };
  return result;
}

export function updatePatient(id: number, input: Partial<PatientInput>): void {
  sessionManager.ensurePermission('patients.edit');
  const db = getDb();
  const cur = db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL').get<Record<string, string | number | null>>(id);
  if (!cur) throw new NotFoundError('Patient');

  const merged: PatientInput = {
    fullName: input.fullName !== undefined ? input.fullName : String(cur.full_name),
    age: input.age !== undefined ? input.age : (cur.age as number | null),
    gender: input.gender !== undefined ? input.gender : String(cur.gender),
    bloodGroup: input.bloodGroup !== undefined ? input.bloodGroup : String(cur.blood_group),
    address: input.address !== undefined ? input.address : String(cur.address),
    phone: input.phone !== undefined ? input.phone : String(cur.phone),
    emergencyPhone: input.emergencyPhone !== undefined ? input.emergencyPhone : String(cur.emergency_phone),
    presentComplaint: input.presentComplaint !== undefined ? input.presentComplaint : String(cur.present_complaint),
    pastHistory: input.pastHistory !== undefined ? input.pastHistory : String(cur.past_history),
    notes: input.notes !== undefined ? input.notes : String(cur.notes),
    identifier: input.identifier !== undefined ? input.identifier : String(cur.identifier),
  };
  validatePatient(merged);

  if (input.patientCode && input.patientCode.trim() !== cur.patient_code) {
    const codeTaken = db.prepare('SELECT id FROM patients WHERE patient_code = ? AND id != ?').get(input.patientCode.trim(), id);
    if (codeTaken) throw new ValidationError(`Patient code "${input.patientCode.trim()}" is already in use.`);
  }

  db.prepare(
    `UPDATE patients SET patient_code = ?, full_name = ?, age = ?, gender = ?, blood_group = ?, address = ?,
     phone = ?, emergency_phone = ?, present_complaint = ?, past_history = ?, notes = ?, identifier = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.patientCode?.trim() || String(cur.patient_code),
    merged.fullName.trim(),
    merged.age ?? null,
    merged.gender ?? '',
    merged.bloodGroup ?? '',
    merged.address?.trim() ?? '',
    merged.phone?.trim() ?? '',
    merged.emergencyPhone?.trim() ?? '',
    merged.presentComplaint?.trim() ?? '',
    merged.pastHistory?.trim() ?? '',
    merged.notes?.trim() ?? '',
    merged.identifier?.trim() ?? '',
    nowIso(),
    id,
  );
  audit({ action: 'patient.updated', entity: 'patient', entityId: id });
}

/** Soft delete — requires patients.delete; blocked when financial/clinical history exists unless forced. */
export function deletePatient(id: number, confirmationText: string): void {
  sessionManager.ensurePermission('patients.delete');
  const db = getDb();
  const p = db.prepare('SELECT full_name, patient_code FROM patients WHERE id = ? AND deleted_at IS NULL').get<{
    full_name: string;
    patient_code: string;
  }>(id);
  if (!p) throw new NotFoundError('Patient');
  if (confirmationText !== p.patient_code) {
    throw new ValidationError('Confirmation text does not match the patient code. Deletion cancelled.');
  }
  const hasFinancials =
    (db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE patient_id = ? AND deleted_at IS NULL').get<{ c: number }>(id)?.c ?? 0) > 0;
  if (hasFinancials) {
    throw new AppError(
      'PATIENT_HAS_HISTORY',
      'This patient has invoices/payments and cannot be deleted to protect financial integrity. Archive the patient instead.',
    );
  }
  db.prepare("UPDATE patients SET deleted_at = ?, status = 'archived' WHERE id = ?").run(nowIso(), id);
  audit({ action: 'patient.deleted', entity: 'patient', entityId: id, details: { code: p.patient_code } });
}

export function setPatientPinned(id: number, pinned: boolean): void {
  sessionManager.ensurePermission('patients.edit');
  const res = getDb().prepare('UPDATE patients SET is_pinned = ? WHERE id = ? AND deleted_at IS NULL').run(pinned ? 1 : 0, id);
  if (!res.changes) throw new NotFoundError('Patient');
}

export function setPatientStatus(id: number, status: 'active' | 'inactive' | 'archived'): void {
  sessionManager.ensurePermission('patients.edit');
  const res = getDb().prepare('UPDATE patients SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    status,
    nowIso(),
    id,
  );
  if (!res.changes) throw new NotFoundError('Patient');
  audit({ action: 'patient.status_changed', entity: 'patient', entityId: id, details: { status } });
}

/** Patient financial history (permission-gated to financial view). */
export function patientFinancialHistory(id: number) {
  sessionManager.ensurePermission('financial.view');
  const db = getDb();
  const invoices = db
    .prepare(
      `SELECT id, invoice_no, invoice_date, grand_total_paisa, paid_paisa, status
       FROM invoices WHERE patient_id = ? AND deleted_at IS NULL ORDER BY invoice_date DESC`,
    )
    .all(id);
  const payments = db
    .prepare(
      `SELECT p.id, p.receipt_no, p.amount_paisa, p.paid_at, p.reference, pm.name AS method
       FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
       WHERE p.patient_id = ? ORDER BY p.paid_at DESC`,
    )
    .all(id);
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(grand_total_paisa),0) AS billed, COALESCE(SUM(paid_paisa),0) AS paid
       FROM invoices WHERE patient_id = ? AND status != 'void' AND deleted_at IS NULL`,
    )
    .get<{ billed: number; paid: number }>(id)!;
  return { invoices, payments, totals: { ...totals, outstanding: totals.billed - totals.paid } };
}

export function searchPatientsForPicker(term: string, limit = 8) {
  sessionManager.ensurePermission('patients.view');
  const s = `%${term.trim()}%`;
  return getDb()
    .prepare(
      `SELECT id, patient_code, full_name, phone FROM patients
       WHERE deleted_at IS NULL AND (full_name LIKE ? OR patient_code LIKE ? OR phone LIKE ?)
       ORDER BY is_pinned DESC, updated_at DESC LIMIT ?`,
    )
    .all(s, s, s, limit);
}
