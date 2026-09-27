import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso, isValidDateOnly } from '../../shared/datetime';
import { audit } from './audit';

export interface ReferralInput {
  patientId: number;
  referredAt?: string;
  referringDentistId?: number | null;
  referredToDoctor: string;
  referredToClinic?: string;
  reason?: string;
  notes?: string;
  followUpDate?: string | null;
}

export function createReferral(input: ReferralInput): { id: number } {
  sessionManager.ensurePermission('visits.create');
  if (!input.referredToDoctor?.trim()) throw new ValidationError('Referred-to doctor is required.');
  const db = getDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ValidationError('Patient not found.');
  if (input.followUpDate && !isValidDateOnly(input.followUpDate)) throw new ValidationError('Follow-up date must be YYYY-MM-DD.');
  const me = sessionManager.currentUser();
  const res = db
    .prepare(
      `INSERT INTO referrals (patient_id, referred_at, referring_dentist_id, referred_to_doctor, referred_to_clinic, reason, notes, status, follow_up_date, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'referred', ?, ?, ?, ?)`,
    )
    .run(
      input.patientId,
      input.referredAt ?? nowIso(),
      input.referringDentistId ?? null,
      input.referredToDoctor.trim(),
      input.referredToClinic?.trim() ?? '',
      input.reason?.trim() ?? '',
      input.notes?.trim() ?? '',
      input.followUpDate ?? null,
      me.userId,
      nowIso(),
      nowIso(),
    );
  audit({ action: 'referral.created', entity: 'referral', entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid };
}

export function listReferrals(patientId: number) {
  sessionManager.ensurePermission('clinical.view');
  return getDb()
    .prepare(
      `SELECT r.*, d.full_name AS referring_dentist_name FROM referrals r
       LEFT JOIN dentists d ON d.id = r.referring_dentist_id
       WHERE r.patient_id = ? ORDER BY r.referred_at DESC`,
    )
    .all(patientId);
}

export function updateReferralStatus(id: number, status: 'referred' | 'follow-up' | 'completed' | 'cancelled', outcome?: string): void {
  sessionManager.ensurePermission('visits.edit');
  const res = getDb()
    .prepare('UPDATE referrals SET status = ?, outcome = COALESCE(?, outcome), updated_at = ? WHERE id = ?')
    .run(status, outcome ?? null, nowIso(), id);
  if (!res.changes) throw new NotFoundError('Referral');
  audit({ action: 'referral.status', entity: 'referral', entityId: id, details: { status } });
}
