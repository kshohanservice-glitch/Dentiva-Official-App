/** Dentist profiles. Viewable broadly (needed on prescriptions/appointments); managed via settings. */
import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso } from '../../shared/datetime';
import { audit } from './audit';

export interface DentistInput {
  fullName: string;
  title?: string;
  designations?: string;
  registrationNo?: string;
  phone?: string;
  email?: string;
  consultationHours?: string;
  status?: 'active' | 'inactive';
}

export function listDentists(includeInactive = false) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, full_name, title, designations, registration_no, phone, email, signature_path, photo_path,
              consultation_hours, status, sort_order
       FROM dentists WHERE deleted_at IS NULL ${includeInactive ? '' : "AND status = 'active'"}
       ORDER BY sort_order ASC, id ASC`,
    )
    .all();
}

export function createDentist(input: DentistInput) {
  sessionManager.ensurePermission('settings.manage');
  if (!input.fullName?.trim()) throw new ValidationError('Dentist full name is required.');
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new ValidationError('Email is not valid.');
  const at = nowIso();
  const res = getDb()
    .prepare(
      `INSERT INTO dentists (full_name, title, designations, registration_no, phone, email, consultation_hours, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.fullName.trim(),
      input.title?.trim() ?? '',
      input.designations?.trim() ?? '',
      input.registrationNo?.trim() ?? '',
      input.phone?.trim() ?? '',
      input.email?.trim() ?? '',
      input.consultationHours?.trim() ?? '',
      input.status ?? 'active',
      Date.now() % 100000,
      at,
      at,
    );
  audit({ action: 'dentist.created', entity: 'dentist', entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid };
}

export function updateDentist(id: number, input: Partial<DentistInput>): void {
  sessionManager.ensurePermission('settings.manage');
  const db = getDb();
  const cur = db.prepare('SELECT * FROM dentists WHERE id = ? AND deleted_at IS NULL').get<Record<string, string | number | null>>(id);
  if (!cur) throw new NotFoundError('Dentist');
  const fullName = (input.fullName ?? String(cur.full_name)).trim();
  if (!fullName) throw new ValidationError('Dentist full name is required.');
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new ValidationError('Email is not valid.');
  db.prepare(
    `UPDATE dentists SET full_name = ?, title = ?, designations = ?, registration_no = ?, phone = ?, email = ?,
     consultation_hours = ?, status = ?, updated_at = ? WHERE id = ?`,
  ).run(
    fullName,
    input.title ?? String(cur.title),
    input.designations ?? String(cur.designations),
    input.registrationNo ?? String(cur.registration_no),
    input.phone ?? String(cur.phone),
    input.email ?? String(cur.email),
    input.consultationHours ?? String(cur.consultation_hours),
    input.status ?? (String(cur.status) as 'active' | 'inactive'),
    nowIso(),
    id,
  );
  audit({ action: 'dentist.updated', entity: 'dentist', entityId: id });
}

export function softDeleteDentist(id: number): void {
  sessionManager.ensurePermission('settings.manage');
  const res = getDb().prepare('UPDATE dentists SET deleted_at = ?, status = ? WHERE id = ?').run(nowIso(), 'inactive', id);
  if (!res.changes) throw new NotFoundError('Dentist');
  audit({ action: 'dentist.deleted', entity: 'dentist', entityId: id });
}

export function getClinicForHeader() {
  const row = getDb()
    .prepare('SELECT name, address, phone, tagline, logo_path FROM clinic WHERE id = 1')
    .get<Record<string, string | null>>();
  return row;
}
