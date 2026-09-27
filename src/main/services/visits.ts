/**
 * Visit management — historically traceable clinical encounters.
 */
import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso } from '../../shared/datetime';
import { audit } from './audit';

export interface VisitInput {
  patientId: number;
  dentistId?: number | null;
  visitDate?: string;
  chiefComplaint?: string;
  history?: string;
  examination?: string;
  diagnosis?: string;
  treatment?: string;
  advice?: string;
  followUp?: string;
  clinicalNotes?: string;
  status?: 'completed' | 'in-progress' | 'cancelled';
}

export function createVisit(input: VisitInput): { id: number } {
  sessionManager.ensurePermission('visits.create');
  const db = getDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ValidationError('Patient not found.');
  const at = nowIso();
  const me = sessionManager.currentUser();
  const res = db
    .prepare(
      `INSERT INTO visits (patient_id, dentist_id, visit_date, chief_complaint, history, examination, diagnosis,
        treatment, advice, follow_up, clinical_notes, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.patientId,
      input.dentistId ?? null,
      input.visitDate ?? at,
      input.chiefComplaint?.trim() ?? '',
      input.history?.trim() ?? '',
      input.examination?.trim() ?? '',
      input.diagnosis?.trim() ?? '',
      input.treatment?.trim() ?? '',
      input.advice?.trim() ?? '',
      input.followUp?.trim() ?? '',
      input.clinicalNotes?.trim() ?? '',
      input.status ?? 'completed',
      me.userId,
      at,
      at,
    );
  audit({ action: 'visit.created', entity: 'visit', entityId: res.lastInsertRowid, details: { patient: input.patientId } });
  return { id: res.lastInsertRowid };
}

export function listVisits(patientId: number) {
  sessionManager.ensurePermission('clinical.view');
  return getDb()
    .prepare(
      `SELECT v.*, d.full_name AS dentist_name FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id
       WHERE v.patient_id = ? AND v.deleted_at IS NULL ORDER BY v.visit_date DESC, v.id DESC`,
    )
    .all(patientId);
}

export function getVisit(id: number) {
  sessionManager.ensurePermission('clinical.view');
  const v = getDb()
    .prepare('SELECT v.*, d.full_name AS dentist_name FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id WHERE v.id = ? AND v.deleted_at IS NULL')
    .get(id);
  if (!v) throw new NotFoundError('Visit');
  return v;
}

export function updateVisit(id: number, input: Partial<Omit<VisitInput, 'patientId'>>): void {
  sessionManager.ensurePermission('visits.edit');
  const db = getDb();
  const cur = db.prepare('SELECT * FROM visits WHERE id = ? AND deleted_at IS NULL').get<Record<string, string | number | null>>(id);
  if (!cur) throw new NotFoundError('Visit');
  db.prepare(
    `UPDATE visits SET dentist_id = ?, visit_date = ?, chief_complaint = ?, history = ?, examination = ?, diagnosis = ?,
     treatment = ?, advice = ?, follow_up = ?, clinical_notes = ?, status = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.dentistId !== undefined ? input.dentistId : cur.dentist_id,
    input.visitDate ?? String(cur.visit_date),
    input.chiefComplaint ?? String(cur.chief_complaint),
    input.history ?? String(cur.history),
    input.examination ?? String(cur.examination),
    input.diagnosis ?? String(cur.diagnosis),
    input.treatment ?? String(cur.treatment),
    input.advice ?? String(cur.advice),
    input.followUp ?? String(cur.follow_up),
    input.clinicalNotes ?? String(cur.clinical_notes),
    input.status ?? (String(cur.status) as 'completed' | 'in-progress' | 'cancelled'),
    nowIso(),
    id,
  );
  audit({ action: 'visit.updated', entity: 'visit', entityId: id });
}

export function softDeleteVisit(id: number): void {
  sessionManager.ensurePermission('visits.edit');
  const db = getDb();
  const hasRx = db.prepare('SELECT COUNT(*) AS c FROM prescriptions WHERE visit_id = ? AND deleted_at IS NULL').get<{ c: number }>(id)?.c ?? 0;
  if (hasRx > 0) {
    throw new ValidationError('This visit has prescriptions attached and cannot be removed. Cancel or edit it instead.');
  }
  const res = db.prepare('UPDATE visits SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
  if (!res.changes) throw new NotFoundError('Visit');
  audit({ action: 'visit.deleted', entity: 'visit', entityId: id });
}

// --- clinical notes -----------------------------------------------------------

export function addClinicalNote(patientId: number, noteText: string, visitId?: number | null, dentistId?: number | null): { id: number } {
  sessionManager.ensurePermission('visits.create');
  if (!noteText.trim()) throw new ValidationError('Note text is required.');
  const me = sessionManager.currentUser();
  const res = getDb()
    .prepare('INSERT INTO clinical_notes (patient_id, visit_id, dentist_id, note_text, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(patientId, visitId ?? null, dentistId ?? null, noteText.trim(), me.userId, nowIso());
  audit({ action: 'note.created', entity: 'clinical_note', entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid };
}

export function listClinicalNotes(patientId: number) {
  sessionManager.ensurePermission('clinical.view');
  return getDb()
    .prepare('SELECT * FROM clinical_notes WHERE patient_id = ? ORDER BY created_at DESC')
    .all(patientId);
}
