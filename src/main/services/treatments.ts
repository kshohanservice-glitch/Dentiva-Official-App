/**
 * Treatment catalog + treatment records.
 * Catalog items are reusable; records snapshot the price at time of treatment.
 */
import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso } from '../../shared/datetime';
import { audit } from './audit';

export interface TreatmentInput {
  name: string;
  code: string;
  category?: string;
  description?: string;
  defaultPricePaisa?: number;
  durationMinutes?: number;
  notes?: string;
}

export function listTreatments(includeInactive = false, term = '') {
  sessionManager.ensurePermission('treatments.view');
  const where = [`(${includeInactive ? '1=1' : 'is_active = 1'})`];
  const params: (string | number)[] = [];
  if (term.trim()) {
    where.push('(name LIKE ? OR code LIKE ? OR category LIKE ?)');
    const s = `%${term.trim()}%`;
    params.push(s, s, s);
  }
  return getDb()
    .prepare(`SELECT * FROM treatments WHERE ${where.join(' AND ')} ORDER BY category ASC, name ASC`)
    .all(...params);
}

export function createTreatment(input: TreatmentInput): { id: number } {
  sessionManager.ensurePermission('treatments.manage');
  if (!input.name?.trim()) throw new ValidationError('Treatment name is required.');
  if (!input.code?.trim()) throw new ValidationError('Treatment code is required.');
  if (input.defaultPricePaisa !== undefined && (!Number.isInteger(input.defaultPricePaisa) || input.defaultPricePaisa < 0)) {
    throw new ValidationError('Default price cannot be negative.');
  }
  const db = getDb();
  if (db.prepare('SELECT id FROM treatments WHERE code = ?').get(input.code.trim())) {
    throw new ValidationError(`Treatment code "${input.code.trim()}" already exists.`);
  }
  const at = nowIso();
  const res = db
    .prepare(
      `INSERT INTO treatments (name, code, category, description, default_price_paisa, duration_minutes, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.code.trim(),
      input.category?.trim() ?? '',
      input.description?.trim() ?? '',
      input.defaultPricePaisa ?? 0,
      input.durationMinutes ?? 30,
      input.notes?.trim() ?? '',
      at,
      at,
    );
  audit({ action: 'treatment_catalog.created', entity: 'treatment', entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid };
}

export function updateTreatment(id: number, input: Partial<TreatmentInput> & { isActive?: boolean }): void {
  sessionManager.ensurePermission('treatments.manage');
  const db = getDb();
  const cur = db.prepare('SELECT * FROM treatments WHERE id = ?').get<Record<string, string | number>>(id);
  if (!cur) throw new NotFoundError('Treatment');
  if (input.code && input.code.trim() !== cur.code) {
    if (db.prepare('SELECT id FROM treatments WHERE code = ? AND id != ?').get(input.code.trim(), id)) {
      throw new ValidationError('Another treatment already uses this code.');
    }
  }
  db.prepare(
    `UPDATE treatments SET name = ?, code = ?, category = ?, description = ?, default_price_paisa = ?, duration_minutes = ?, is_active = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.name?.trim() ?? String(cur.name),
    input.code?.trim() ?? String(cur.code),
    input.category ?? String(cur.category),
    input.description ?? String(cur.description),
    input.defaultPricePaisa ?? Number(cur.default_price_paisa),
    input.durationMinutes ?? Number(cur.duration_minutes),
    input.isActive === undefined ? cur.is_active : input.isActive ? 1 : 0,
    input.notes ?? String(cur.notes),
    nowIso(),
    id,
  );
  audit({ action: 'treatment_catalog.updated', entity: 'treatment', entityId: id });
}

export function listCategories(): string[] {
  sessionManager.ensurePermission('treatments.view');
  return getDb()
    .prepare("SELECT DISTINCT category FROM treatments WHERE category != '' ORDER BY category")
    .all<{ category: string }>()
    .map((r) => r.category);
}

// --- treatment records ---------------------------------------------------------

export interface TreatmentRecordInput {
  patientId: number;
  visitId?: number | null;
  treatmentId: number;
  toothNo?: string;
  pricePaisa?: number; // defaults to catalog price snapshot
  status?: 'planned' | 'in-progress' | 'completed';
  note?: string;
  performedBy?: number | null;
}

export function recordTreatment(input: TreatmentRecordInput): { id: number; pricePaisa: number } {
  sessionManager.ensurePermission('visits.create');
  const db = getDb();
  const catalog = db.prepare('SELECT id, default_price_paisa FROM treatments WHERE id = ?').get<{ id: number; default_price_paisa: number }>(input.treatmentId);
  if (!catalog) throw new ValidationError('Treatment not found in catalog.');
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ValidationError('Patient not found.');
  const price = input.pricePaisa ?? catalog.default_price_paisa;
  if (!Number.isInteger(price) || price < 0) throw new ValidationError('Treatment price cannot be negative.');
  const me = sessionManager.currentUser();
  const res = db
    .prepare(
      `INSERT INTO treatment_records (patient_id, visit_id, treatment_id, tooth_no, price_paisa, status, note, performed_by, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.patientId,
      input.visitId ?? null,
      input.treatmentId,
      input.toothNo?.trim() ?? '',
      price,
      input.status ?? 'completed',
      input.note?.trim() ?? '',
      input.performedBy ?? null,
      me.userId,
      nowIso(),
      nowIso(),
    );
  audit({ action: 'treatment_record.created', entity: 'treatment_record', entityId: res.lastInsertRowid, details: { patient: input.patientId } });
  return { id: res.lastInsertRowid, pricePaisa: price };
}

export function listTreatmentRecords(patientId: number) {
  sessionManager.ensurePermission('clinical.view');
  return getDb()
    .prepare(
      `SELECT tr.*, t.name AS treatment_name, t.category, d.full_name AS performed_by_name
       FROM treatment_records tr
       JOIN treatments t ON t.id = tr.treatment_id
       LEFT JOIN dentists d ON d.id = tr.performed_by
       WHERE tr.patient_id = ? ORDER BY tr.created_at DESC`,
    )
    .all(patientId);
}

export function updateTreatmentRecordStatus(id: number, status: 'planned' | 'in-progress' | 'completed'): void {
  sessionManager.ensurePermission('visits.edit');
  const res = getDb().prepare('UPDATE treatment_records SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  if (!res.changes) throw new NotFoundError('Treatment record');
  audit({ action: 'treatment_record.status', entity: 'treatment_record', entityId: id, details: { status } });
}
