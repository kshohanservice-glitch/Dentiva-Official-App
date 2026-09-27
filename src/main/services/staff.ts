/**
 * Staff records. Sensitive fields (salary, NID) are gated: viewing the full
 * record requires staff.manage; staff.view sees the non-sensitive profile.
 */
import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso, isValidDateOnly } from '../../shared/datetime';
import { audit } from './audit';

export interface StaffInput {
  name: string;
  dateOfBirth?: string | null;
  gender?: string;
  bloodGroup?: string;
  address?: string;
  phone?: string;
  nationalId?: string;
  position?: string;
  department?: string;
  joiningDate?: string | null;
  salaryPaisa?: number;
  notes?: string;
}

export function listStaff(includeInactive = false) {
  sessionManager.ensurePermission('staff.view');
  const canSeeSensitive = sessionManager.currentUser().permissions.has('staff.manage');
  const rows = getDb()
    .prepare(
      `SELECT s.*, u.username AS linked_username FROM staff s LEFT JOIN users u ON u.staff_id = s.id
       WHERE ${includeInactive ? '1=1' : "s.status = 'active'"} AND s.deleted_at IS NULL ORDER BY s.name ASC`,
    )
    .all<Record<string, unknown>>();
  if (canSeeSensitive) return rows;
  return rows.map((r) => ({ ...r, salary_paisa: null, national_id: '' }));
}

export function getStaffMember(id: number) {
  sessionManager.ensurePermission('staff.view');
  const row = getDb().prepare('SELECT * FROM staff WHERE id = ? AND deleted_at IS NULL').get<Record<string, unknown>>(id);
  if (!row) throw new NotFoundError('Staff member');
  if (!sessionManager.currentUser().permissions.has('staff.manage')) {
    return { ...row, salary_paisa: null, national_id: '' };
  }
  return row;
}

export function createStaff(input: StaffInput): { id: number } {
  sessionManager.ensurePermission('staff.manage');
  if (!input.name?.trim()) throw new ValidationError('Staff name is required.');
  if (input.dateOfBirth && !isValidDateOnly(input.dateOfBirth)) throw new ValidationError('Date of birth must be YYYY-MM-DD.');
  if (input.joiningDate && !isValidDateOnly(input.joiningDate)) throw new ValidationError('Joining date must be YYYY-MM-DD.');
  if (input.salaryPaisa !== undefined && (!Number.isInteger(input.salaryPaisa) || input.salaryPaisa < 0)) {
    throw new ValidationError('Salary cannot be negative.');
  }
  const at = nowIso();
  const res = getDb()
    .prepare(
      `INSERT INTO staff (name, date_of_birth, gender, blood_group, address, phone, national_id, position, department, joining_date, salary_paisa, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.dateOfBirth ?? null,
      input.gender ?? '',
      input.bloodGroup ?? '',
      input.address?.trim() ?? '',
      input.phone?.trim() ?? '',
      input.nationalId?.trim() ?? '',
      input.position?.trim() ?? '',
      input.department?.trim() ?? '',
      input.joiningDate ?? null,
      input.salaryPaisa ?? 0,
      input.notes?.trim() ?? '',
      at,
      at,
    );
  audit({ action: 'staff.created', entity: 'staff', entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid };
}

export function updateStaff(id: number, input: Partial<StaffInput> & { status?: 'active' | 'inactive' }): void {
  sessionManager.ensurePermission('staff.manage');
  const db = getDb();
  const cur = db.prepare('SELECT * FROM staff WHERE id = ? AND deleted_at IS NULL').get<Record<string, string | number | null>>(id);
  if (!cur) throw new NotFoundError('Staff member');
  if (input.dateOfBirth && !isValidDateOnly(input.dateOfBirth)) throw new ValidationError('Date of birth must be YYYY-MM-DD.');
  if (input.joiningDate && !isValidDateOnly(input.joiningDate)) throw new ValidationError('Joining date must be YYYY-MM-DD.');
  db.prepare(
    `UPDATE staff SET name = ?, date_of_birth = ?, gender = ?, blood_group = ?, address = ?, phone = ?, national_id = ?,
     position = ?, department = ?, joining_date = ?, salary_paisa = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.name?.trim() ?? String(cur.name),
    input.dateOfBirth !== undefined ? input.dateOfBirth : cur.date_of_birth,
    input.gender ?? String(cur.gender),
    input.bloodGroup ?? String(cur.blood_group),
    input.address ?? String(cur.address),
    input.phone ?? String(cur.phone),
    input.nationalId ?? String(cur.national_id),
    input.position ?? String(cur.position),
    input.department ?? String(cur.department),
    input.joiningDate !== undefined ? input.joiningDate : cur.joining_date,
    input.salaryPaisa ?? Number(cur.salary_paisa),
    input.notes ?? String(cur.notes),
    input.status ?? (String(cur.status) as 'active' | 'inactive'),
    nowIso(),
    id,
  );
  audit({ action: 'staff.updated', entity: 'staff', entityId: id });
}

export function softDeleteStaff(id: number): void {
  sessionManager.ensurePermission('staff.manage');
  const db = getDb();
  const linked = db.prepare('SELECT COUNT(*) AS c FROM users WHERE staff_id = ?').get<{ c: number }>(id)?.c ?? 0;
  if (linked > 0) {
    throw new ValidationError('This staff member is linked to a user account. Disable the user instead of deleting the staff record.');
  }
  const res = db.prepare("UPDATE staff SET deleted_at = ?, status = 'inactive', updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  if (!res.changes) throw new NotFoundError('Staff member');
  audit({ action: 'staff.deleted', entity: 'staff', entityId: id });
}
