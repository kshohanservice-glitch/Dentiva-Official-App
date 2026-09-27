/**
 * Clinical timeline — chronological union of real events for a patient.
 */
import { getDb } from '../db/connection';
import { sessionManager } from './session';

export interface TimelineEvent {
  at: string;
  type: string;
  title: string;
  detail: string;
  entityId: number;
  who: string | null;
}

export function patientTimeline(patientId: number, filterType = ''): TimelineEvent[] {
  sessionManager.ensurePermission('clinical.view');
  const db = getDb();
  const events: TimelineEvent[] = [];

  const patient = db.prepare('SELECT full_name, patient_code, created_at FROM patients WHERE id = ? AND deleted_at IS NULL').get<{
    full_name: string;
    patient_code: string;
    created_at: string;
  }>(patientId);
  if (!patient) return events;

  events.push({
    at: patient.created_at,
    type: 'registration',
    title: 'Patient registered',
    detail: `${patient.full_name} (${patient.patient_code})`,
    entityId: patientId,
    who: null,
  });

  const rows = db
    .prepare(
      `SELECT v.visit_date AS at, v.id, v.chief_complaint, v.diagnosis, v.status, d.full_name AS dentist
       FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id
       WHERE v.patient_id = ? AND v.deleted_at IS NULL`,
    )
    .all<{ at: string; id: number; chief_complaint: string; diagnosis: string; status: string; dentist: string | null }>(patientId);
  for (const r of rows) {
    events.push({
      at: r.at,
      type: 'visit',
      title: r.status === 'cancelled' ? 'Visit (cancelled)' : 'Visit',
      detail: [r.chief_complaint && `C/C: ${r.chief_complaint}`, r.diagnosis && `Dx: ${r.diagnosis}`].filter(Boolean).join(' · ') || 'Clinical visit',
      entityId: r.id,
      who: r.dentist,
    });
  }

  const chart = db
    .prepare(
      `SELECT ce.created_at AS at, ce.id, ce.tooth_no, ce.condition, ce.note, d.full_name AS dentist
       FROM chart_entries ce LEFT JOIN dentists d ON d.id = ce.dentist_id WHERE ce.patient_id = ?`,
    )
    .all<{ at: string; id: number; tooth_no: number; condition: string; note: string; dentist: string | null }>(patientId);
  for (const r of chart) {
    events.push({
      at: r.at,
      type: 'chart',
      title: `Chart: tooth ${r.tooth_no} — ${r.condition}`,
      detail: r.note || '',
      entityId: r.id,
      who: r.dentist,
    });
  }

  const rx = db
    .prepare(
      `SELECT p.created_at AS at, p.id, p.rx_no, d.full_name AS dentist
       FROM prescriptions p LEFT JOIN dentists d ON d.id = p.dentist_id
       WHERE p.patient_id = ? AND p.deleted_at IS NULL`,
    )
    .all<{ at: string; id: number; rx_no: string; dentist: string | null }>(patientId);
  for (const r of rx) {
    events.push({ at: r.at, type: 'prescription', title: `Prescription ${r.rx_no}`, detail: '', entityId: r.id, who: r.dentist });
  }

  const inv = db
    .prepare(`SELECT invoice_date AS at, id, invoice_no, grand_total_paisa, status FROM invoices WHERE patient_id = ? AND deleted_at IS NULL`)
    .all<{ at: string; id: number; invoice_no: string; grand_total_paisa: number; status: string }>(patientId);
  for (const r of inv) {
    events.push({
      at: r.at,
      type: 'invoice',
      title: `Invoice ${r.invoice_no}`,
      detail: `${(r.grand_total_paisa / 100).toFixed(2)} BDT · ${r.status}`,
      entityId: r.id,
      who: null,
    });
  }

  const pay = db
    .prepare(
      `SELECT p.paid_at AS at, p.id, p.receipt_no, p.amount_paisa, pm.name AS method
       FROM payments p JOIN payment_methods pm ON pm.id = p.method_id WHERE p.patient_id = ?`,
    )
    .all<{ at: string; id: number; receipt_no: string; amount_paisa: number; method: string }>(patientId);
  for (const r of pay) {
    events.push({
      at: r.at,
      type: 'payment',
      title: `Payment ${r.receipt_no}`,
      detail: `${(r.amount_paisa / 100).toFixed(2)} BDT via ${r.method}`,
      entityId: r.id,
      who: null,
    });
  }

  const appts = db
    .prepare(`SELECT created_at AS at, id, appt_date, start_time, status, appt_type FROM appointments WHERE patient_id = ?`)
    .all<{ at: string; id: number; appt_date: string; start_time: string; status: string; appt_type: string }>(patientId);
  for (const r of appts) {
    events.push({
      at: r.at,
      type: 'appointment',
      title: `Appointment ${r.appt_date} ${r.start_time}`,
      detail: `${r.appt_type} · ${r.status}`,
      entityId: r.id,
      who: null,
    });
  }

  const notes = db
    .prepare(`SELECT created_at AS at, id, note_text FROM clinical_notes WHERE patient_id = ?`)
    .all<{ at: string; id: number; note_text: string }>(patientId);
  for (const r of notes) {
    events.push({ at: r.at, type: 'note', title: 'Clinical note', detail: r.note_text, entityId: r.id, who: null });
  }

  const refs = db
    .prepare(`SELECT referred_at AS at, id, referred_to_doctor, referred_to_clinic, reason FROM referrals WHERE patient_id = ?`)
    .all<{ at: string; id: number; referred_to_doctor: string; referred_to_clinic: string; reason: string }>(patientId);
  for (const r of refs) {
    events.push({
      at: r.at,
      type: 'referral',
      title: `Referred to ${r.referred_to_doctor || 'external doctor'}`,
      detail: [r.referred_to_clinic, r.reason].filter(Boolean).join(' · '),
      entityId: r.id,
      who: null,
    });
  }

  const attach = db
    .prepare(`SELECT created_at AS at, id, original_name FROM attachments WHERE entity_type = 'patient' AND entity_id = ? AND deleted_at IS NULL`)
    .all<{ at: string; id: number; original_name: string }>(patientId);
  for (const r of attach) {
    events.push({ at: r.at, type: 'attachment', title: 'Attachment added', detail: r.original_name, entityId: r.id, who: null });
  }

  const filtered = filterType ? events.filter((e) => e.type === filterType) : events;
  return filtered.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
