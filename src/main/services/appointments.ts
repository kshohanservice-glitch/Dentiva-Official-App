/**
 * Appointments: day/week/month/agenda data, conflict detection, status lifecycle.
 */
import { getDb, tx } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso, isValidDateOnly, isValidTime, todayLocal, addDays } from '../../shared/datetime';
import { audit } from './audit';

export const APPT_STATUSES = [
  'scheduled', 'confirmed', 'arrived', 'in-queue', 'in-progress', 'completed', 'cancelled', 'no-show', 'rescheduled',
] as const;

export interface AppointmentInput {
  patientId: number;
  dentistId?: number | null;
  apptDate: string;
  startTime: string;
  durationMinutes?: number;
  apptType?: string;
  notes?: string;
}

function validateSlot(input: AppointmentInput): void {
  if (!isValidDateOnly(input.apptDate)) throw new ValidationError('Appointment date must be YYYY-MM-DD.');
  if (!isValidTime(input.startTime)) throw new ValidationError('Start time must be HH:MM.');
  const dur = input.durationMinutes ?? 30;
  if (!Number.isInteger(dur) || dur < 5 || dur > 480) throw new ValidationError('Duration must be between 5 and 480 minutes.');
}

/** Detect overlapping appointments for the same dentist (excluding cancelled). */
function findConflict(input: AppointmentInput, excludeId?: number): { id: number; start_time: string } | undefined {
  const db = getDb();
  const dur = input.durationMinutes ?? 30;
  const params: (string | number)[] = [input.apptDate, input.dentistId as number];
  if (excludeId !== undefined) params.push(excludeId);
  const rows = db
    .prepare(
      `SELECT id, start_time, duration_minutes FROM appointments
       WHERE appt_date = ? AND dentist_id IS NOT NULL AND dentist_id = ? AND status NOT IN ('cancelled','no-show') ${excludeId !== undefined ? 'AND id != ?' : ''}`,
    )
    .all<{ id: number; start_time: string; duration_minutes: number }>(...params);
  const toMin = (t: string) => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
  const newStart = toMin(input.startTime);
  const newEnd = newStart + dur;
  return rows.find((r) => {
    const s = toMin(r.start_time);
    const e = s + r.duration_minutes;
    return newStart < e && s < newEnd;
  });
}

export function createAppointment(input: AppointmentInput): { id: number; conflict: boolean } {
  sessionManager.ensurePermission('appointments.manage');
  validateSlot(input);
  const db = getDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ValidationError('Patient not found.');
  const holiday = db.prepare('SELECT name FROM holidays WHERE holiday_date = ?').get<{ name: string }>(input.apptDate);
  if (holiday) throw new ValidationError(`The clinic is closed on ${input.apptDate} (${holiday.name}).`);
  const wd = new Date(`${input.apptDate}T00:00:00Z`).getUTCDay();
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const clinic = db.prepare('SELECT working_days FROM clinic WHERE id = 1').get<{ working_days: string }>()!;
  if (!clinic.working_days.split(',').includes(days[wd])) {
    throw new ValidationError(`${input.apptDate} is not a working day for this clinic.`);
  }

  const conflict = input.dentistId ? findConflict(input) : undefined;
  const me = sessionManager.currentUser();
  const at = nowIso();
  const res = db
    .prepare(
      `INSERT INTO appointments (patient_id, dentist_id, appt_date, start_time, duration_minutes, appt_type, notes, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
    )
    .run(
      input.patientId,
      input.dentistId ?? null,
      input.apptDate,
      input.startTime,
      input.durationMinutes ?? 30,
      input.apptType?.trim() || 'Consultation',
      input.notes?.trim() ?? '',
      me.userId,
      at,
      at,
    );
  audit({ action: 'appointment.created', entity: 'appointment', entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid, conflict: !!conflict };
}

export function listAppointments(opts: { from: string; to: string; dentistId?: number | null; status?: string }) {
  sessionManager.ensurePermission('appointments.view');
  if (!isValidDateOnly(opts.from) || !isValidDateOnly(opts.to)) throw new ValidationError('Invalid date range.');
  const where: string[] = ['appt_date >= ?', 'appt_date <= ?'];
  const params: (string | number)[] = [opts.from, opts.to];
  if (opts.dentistId) {
    where.push('dentist_id = ?');
    params.push(opts.dentistId);
  }
  if (opts.status && opts.status !== 'all') {
    where.push('status = ?');
    params.push(opts.status);
  }
  return getDb()
    .prepare(
      `SELECT a.*, p.full_name AS patient_name, p.phone AS patient_phone, d.full_name AS dentist_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
       WHERE ${where.join(' AND ')} ORDER BY a.appt_date ASC, a.start_time ASC`,
    )
    .all(...params);
}

export function appointmentAgenda(date: string, dentistId?: number | null) {
  sessionManager.ensurePermission('appointments.view');
  if (!isValidDateOnly(date)) throw new ValidationError('Invalid date.');
  const params: (string | number)[] = [date];
  let extra = '';
  if (dentistId) {
    extra = 'AND dentist_id = ?';
    params.push(dentistId);
  }
  return getDb()
    .prepare(
      `SELECT a.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
       WHERE a.appt_date = ? ${extra} ORDER BY a.start_time ASC`,
    )
    .all(...params);
}

export function setAppointmentStatus(id: number, status: (typeof APPT_STATUSES)[number]): void {
  sessionManager.ensurePermission('appointments.manage');
  if (!APPT_STATUSES.includes(status)) throw new ValidationError('Unknown appointment status.');
  const db = getDb();
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get<{ id: number; status: string }>(id);
  if (!appt) throw new NotFoundError('Appointment');
  db.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  audit({ action: 'appointment.status', entity: 'appointment', entityId: id, details: { status } });
}

export function rescheduleAppointment(id: number, apptDate: string, startTime: string, durationMinutes?: number): { conflict: boolean } {
  sessionManager.ensurePermission('appointments.manage');
  const db = getDb();
  const cur = db.prepare('SELECT * FROM appointments WHERE id = ?').get<Record<string, string | number | null>>(id);
  if (!cur) throw new NotFoundError('Appointment');
  const input: AppointmentInput = {
    patientId: Number(cur.patient_id),
    dentistId: (cur.dentist_id as number | null) ?? null,
    apptDate,
    startTime,
    durationMinutes: durationMinutes ?? Number(cur.duration_minutes),
  };
  validateSlot(input);
  const conflict = input.dentistId ? findConflict(input, id) : undefined;
  const dur = durationMinutes ?? Number(cur.duration_minutes);
  db.prepare('UPDATE appointments SET appt_date = ?, start_time = ?, duration_minutes = ?, status = ?, updated_at = ? WHERE id = ?').run(
    apptDate,
    startTime,
    dur,
    'rescheduled',
    nowIso(),
    id,
  );
  audit({ action: 'appointment.rescheduled', entity: 'appointment', entityId: id, details: { apptDate, startTime } });
  return { conflict: !!conflict };
}

export function cancelAppointment(id: number, reason?: string): void {
  sessionManager.ensurePermission('appointments.manage');
  const db = getDb();
  const res = db.prepare("UPDATE appointments SET status = 'cancelled', notes = CASE WHEN ? = '' THEN notes ELSE notes || CHAR(10) || ('Cancelled: ' || ?) END, updated_at = ? WHERE id = ?").run(
    reason?.trim() ?? '',
    reason?.trim() ?? '',
    nowIso(),
    id,
  );
  if (!res.changes) throw new NotFoundError('Appointment');
  audit({ action: 'appointment.cancelled', entity: 'appointment', entityId: id });
}

export function monthGridCounts(year: number, month: number, dentistId?: number | null) {
  sessionManager.ensurePermission('appointments.view');
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = addDays(from, 31);
  const params: (string | number)[] = [from, to];
  let extra = '';
  if (dentistId) {
    extra = 'AND dentist_id = ?';
    params.push(dentistId);
  }
  return getDb()
    .prepare(
      `SELECT appt_date, COUNT(*) AS n FROM appointments WHERE appt_date >= ? AND appt_date <= ? ${extra} AND status != 'cancelled' GROUP BY appt_date`,
    )
    .all(...params);
}

// --- queue ------------------------------------------------------------------

export function checkIn(patientId: number, dentistId?: number | null, appointmentId?: number | null, priority = false, reason = ''): { id: number; queueNo: number } {
  sessionManager.ensurePermission('queue.manage');
  const db = getDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!patient) throw new ValidationError('Patient not found.');
  const today = todayLocal();
  let out: { id: number; queueNo: number } = { id: 0, queueNo: 0 };
  tx(() => {
    const existing = db
      .prepare("SELECT id FROM queue_entries WHERE queue_date = ? AND patient_id = ? AND status IN ('waiting','in-treatment')")
      .get(today, patientId);
    if (existing) throw new ValidationError('This patient is already in the queue today.');
    const last = db.prepare('SELECT COALESCE(MAX(queue_no), 0) AS m FROM queue_entries WHERE queue_date = ?').get<{ m: number }>(today)!.m;
    const me = sessionManager.currentUser();
    const res = db
      .prepare(
        `INSERT INTO queue_entries (queue_date, queue_no, patient_id, dentist_id, appointment_id, arrived_at, priority, reason, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      )
      .run(today, last + 1, patientId, dentistId ?? null, appointmentId ?? null, nowIso(), priority ? 1 : 0, reason.trim(), me.userId, nowIso());
    if (appointmentId) {
      db.prepare("UPDATE appointments SET status = 'in-queue', updated_at = ? WHERE id = ?").run(nowIso(), appointmentId);
    }
    audit({ action: 'queue.check_in', entity: 'queue_entry', entityId: res.lastInsertRowid });
    out = { id: res.lastInsertRowid, queueNo: last + 1 };
  });
  return out;
}

export function queueList(date?: string) {
  sessionManager.ensurePermission('appointments.view');
  const d = date ?? todayLocal();
  if (!isValidDateOnly(d)) throw new ValidationError('Invalid date.');
  return getDb()
    .prepare(
      `SELECT q.*, p.full_name AS patient_name, p.patient_code, p.phone, d.full_name AS dentist_name
       FROM queue_entries q JOIN patients p ON p.id = q.patient_id LEFT JOIN dentists d ON d.id = q.dentist_id
       WHERE q.queue_date = ? ORDER BY q.priority DESC, q.queue_no ASC`,
    )
    .all(d);
}

export function queueSetStatus(id: number, status: 'waiting' | 'in-treatment' | 'completed' | 'skipped' | 'cancelled'): void {
  sessionManager.ensurePermission('queue.manage');
  const db = getDb();
  const q = db.prepare('SELECT * FROM queue_entries WHERE id = ?').get<{ id: number; appointment_id: number | null; status: string }>(id);
  if (!q) throw new NotFoundError('Queue entry');
  const at = nowIso();
  const started = status === 'in-treatment' && q.status === 'waiting' ? at : null;
  const completed = status === 'completed' ? at : null;
  db.prepare('UPDATE queue_entries SET status = ?, started_at = COALESCE(?, started_at), completed_at = COALESCE(?, completed_at) WHERE id = ?').run(
    status,
    started,
    completed,
    id,
  );
  if (q.appointment_id && (status === 'completed' || status === 'cancelled')) {
    db.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?').run(
      status === 'completed' ? 'completed' : 'cancelled',
      at,
      q.appointment_id,
    );
  }
  audit({ action: `queue.${status}`, entity: 'queue_entry', entityId: id });
}

export function queueReorder(id: number, newPosition: number): void {
  sessionManager.ensurePermission('queue.manage');
  const db = getDb();
  const q = db.prepare('SELECT * FROM queue_entries WHERE id = ?').get<{ id: number; queue_date: string; queue_no: number }>(id);
  if (!q) throw new NotFoundError('Queue entry');
  const today = q.queue_date;
  const entries = db
    .prepare("SELECT id, queue_no FROM queue_entries WHERE queue_date = ? AND status = 'waiting' ORDER BY priority DESC, queue_no ASC")
    .all<{ id: number; queue_no: number }>(today);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) throw new ValidationError('Only waiting entries can be reordered.');
  const target = Math.max(0, Math.min(entries.length - 1, newPosition));
  const [moved] = entries.splice(idx, 1);
  entries.splice(target, 0, moved);
  tx(() => {
    const upd = db.prepare('UPDATE queue_entries SET queue_no = ? WHERE id = ?');
    entries.forEach((e, i) => upd.run(i + 1, e.id));
  });
  audit({ action: 'queue.reordered', entity: 'queue_entry', entityId: id });
}
