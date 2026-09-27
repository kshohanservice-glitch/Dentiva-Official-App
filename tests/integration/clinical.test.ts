import { afterEach, describe, expect, it } from 'vitest';
import { freshDb, bootstrapWithAdmin, type TestCtx } from './helpers';
import { getDb } from '../../src/main/db/connection';
import { createPatient } from '../../src/main/services/patients';
import { createVisit, listVisits, addClinicalNote } from '../../src/main/services/visits';
import { addChartEntries, currentChart, toothHistory, clearTooth, isValidTooth, dentitionOf } from '../../src/main/services/chart';
import { createTreatment, recordTreatment, listTreatmentRecords, updateTreatment } from '../../src/main/services/treatments';
import { createAppointment, appointmentAgenda, setAppointmentStatus, rescheduleAppointment, checkIn, queueList, queueSetStatus } from '../../src/main/services/appointments';
import { createPrescription, getPrescription, upsertMedicine } from '../../src/main/services/prescriptions';
import { patientTimeline } from '../../src/main/services/timeline';
import { ValidationError } from '../../src/main/util/errors';
import { todayLocal, addDays } from '../../src/shared/datetime';

let ctx: TestCtx;
afterEach(() => ctx?.cleanup());

function newPatient(name = 'Clinical Patient') {
  return createPatient({ fullName: name, phone: `+880171${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}` }).id;
}

describe('visits', () => {
  it('creates, lists and rejects unknown patients', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const v = createVisit({ patientId: pid, chiefComplaint: 'Tooth pain', diagnosis: 'Pulpitis', advice: 'Avoid cold drinks' });
    expect(v.id).toBeGreaterThan(0);
    const rows = listVisits(pid) as Array<{ chief_complaint: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].chief_complaint).toBe('Tooth pain');
    expect(() => createVisit({ patientId: 99999, chiefComplaint: 'x' })).toThrow(ValidationError);
    addClinicalNote(pid, 'Note text', v.id);
  });
});

describe('dental chart (FDI)', () => {
  it('validates tooth numbering for adult and pediatric dentition', () => {
    expect(isValidTooth(11)).toBe(true);
    expect(isValidTooth(48)).toBe(true);
    expect(isValidTooth(51)).toBe(true);
    expect(isValidTooth(85)).toBe(true);
    expect(isValidTooth(19)).toBe(false);
    expect(isValidTooth(56)).toBe(false);
    expect(dentitionOf(11)).toBe('adult');
    expect(dentitionOf(75)).toBe('pediatric');
  });

  it('records conditions on multiple teeth and supersedes history', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    addChartEntries({ patientId: pid, teeth: [11, 21], condition: 'caries' });
    let chart = currentChart(pid);
    expect(Object.keys(chart.teeth)).toEqual(['11', '21']);

    // New condition supersedes the old one but keeps history
    addChartEntries({ patientId: pid, teeth: [11], condition: 'rct', note: 'Root canal done' });
    chart = currentChart(pid);
    expect((chart.teeth['11'] as { condition: string }).condition).toBe('rct');
    expect((chart.teeth['21'] as { condition: string }).condition).toBe('caries');
    const hist = toothHistory(pid, 11) as Array<{ condition: string; superseded_at: string | null }>;
    expect(hist).toHaveLength(2);
    expect(hist[0].condition).toBe('rct');
    expect(hist[0].superseded_at).toBeNull();
    expect(hist[1].condition).toBe('caries');
    expect(hist[1].superseded_at).not.toBeNull();

    clearTooth(pid, 21);
    chart = currentChart(pid);
    expect(chart.teeth['21']).toBeUndefined();
    expect(() => addChartEntries({ patientId: pid, teeth: [99], condition: 'caries' })).toThrow(ValidationError);
  });
});

describe('treatments', () => {
  it('catalog CRUD and record price snapshot', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const t = createTreatment({ name: 'Scaling', code: 'SC-01', category: 'Hygiene', defaultPricePaisa: 150000 });
    expect(() => createTreatment({ name: 'Dup', code: 'SC-01' })).toThrow(/already exists/);
    const rec = recordTreatment({ patientId: pid, treatmentId: t.id, toothNo: '11,21' });
    expect(rec.pricePaisa).toBe(150000); // snapshot from catalog
    const rows = listTreatmentRecords(pid) as Array<{ treatment_name: string; price_paisa: number }>;
    expect(rows[0].treatment_name).toBe('Scaling');
    // price snapshot is independent of later catalog changes
    updateTreatment(t.id, { defaultPricePaisa: 200000 });
    expect((listTreatmentRecords(pid) as Array<{ price_paisa: number }>)[0].price_paisa).toBe(150000);
  });
});

describe('appointments & queue', () => {
  it('books on a working day, detects dentist conflicts', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const dId = getDb().prepare('SELECT id FROM dentists LIMIT 1').get<{ id: number }>()!.id;
    // Find the next working day (setup workingDays exclude friday)
    let day = addDays(todayLocal(), 1);
    for (let i = 0; i < 7 && new Date(`${day}T00:00:00Z`).getUTCDay() === 5; i++) day = addDays(day, 1);

    const a = createAppointment({ patientId: pid, dentistId: dId, apptDate: day, startTime: '10:00', durationMinutes: 30 });
    expect(a.conflict).toBe(false);
    // overlapping slot for same dentist → conflict flagged (still books)
    const b = createAppointment({ patientId: pid, dentistId: dId, apptDate: day, startTime: '10:15', durationMinutes: 30 });
    expect(b.conflict).toBe(true);

    const agenda = appointmentAgenda(day, dId) as Array<{ id: number }>;
    expect(agenda).toHaveLength(2);

    setAppointmentStatus(a.id, 'confirmed');
    rescheduleAppointment(b.id, day, '14:00');
    const after = appointmentAgenda(day, dId) as Array<{ start_time: string; status: string }>;
    expect(after.find((x) => x.start_time === '14:00')?.status).toBe('rescheduled');
  });

  it('rejects invalid times and non-working days', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    expect(() => createAppointment({ patientId: pid, apptDate: '2026-13-01', startTime: '10:00' })).toThrow(ValidationError);
    expect(() => createAppointment({ patientId: pid, apptDate: todayLocal(), startTime: '25:00' })).toThrow(ValidationError);
    // Friday is excluded from working days in the standard setup
    let friday = todayLocal();
    while (new Date(`${friday}T00:00:00Z`).getUTCDay() !== 5) friday = addDays(friday, 1);
    expect(() => createAppointment({ patientId: pid, apptDate: friday, startTime: '10:00' })).toThrow(/working day/);
  });

  it('queue check-in assigns numbers, prevents duplicates, and completes', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const p1 = newPatient('Queue One');
    const p2 = newPatient('Queue Two');
    const q1 = checkIn(p1);
    const q2 = checkIn(p2);
    expect(q1.queueNo).toBe(1);
    expect(q2.queueNo).toBe(2);
    expect(() => checkIn(p1)).toThrow(/already in the queue/);

    const list = queueList() as Array<{ id: number; status: string; queue_no: number }>;
    expect(list).toHaveLength(2);

    queueSetStatus(q1.id, 'in-treatment');
    queueSetStatus(q1.id, 'completed');
    const after = queueList() as Array<{ id: number; status: string }>;
    expect(after.find((x) => x.id === q1.id)?.status).toBe('completed');
    expect(after.find((x) => x.id === q2.id)?.status).toBe('waiting');
  });
});

describe('prescriptions', () => {
  it('creates with multiple medicines and clinical fields; Bengali text preserved', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const med = upsertMedicine({ name: 'Amoxicillin', genericName: 'Amoxicillin', form: 'Capsule', strength: '500mg' });
    const rx = createPrescription({
      patientId: pid,
      chiefComplaint: 'দাঁতে ব্যথা (toothache)',
      onExamination: 'Caries in 46',
      advice: 'ঔষধ খাবারের পরে খান',
      items: [
        { medicineName: 'Amoxicillin', medicineId: med.id, form: 'Capsule', strength: '500mg', dose: '1', morning: true, noon: true, night: true, afterFood: true, duration: '7 days', quantity: '21' },
        { medicineName: 'Napa Extend', form: 'Tablet', strength: '665mg', dose: '1', morning: true, night: true, prn: true, additionalInstruction: 'ব্যথার প্রয়োজনে' },
      ],
    });
    expect(rx.rxNo).toMatch(/^RX-\d{5}$/);
    const full = getPrescription(rx.id) as unknown as { chief_complaint: string; advice: string; items: Array<{ medicine_name: string; prn: number }> };
    expect(full.chief_complaint).toBe('দাঁতে ব্যথা (toothache)');
    expect(full.advice).toBe('ঔষধ খাবারের পরে খান');
    expect(full.items).toHaveLength(2);
    expect(full.items[1].prn).toBe(1);
    expect(() => createPrescription({ patientId: pid, items: [] })).toThrow(/at least one medicine/);
    expect(() => createPrescription({ patientId: pid, items: [{ medicineName: '' }] })).toThrow(/name/);
  });
});

describe('clinical timeline', () => {
  it('assembles a chronological history from real records', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    createVisit({ patientId: pid, chiefComplaint: 'Pain' });
    addChartEntries({ patientId: pid, teeth: [36], condition: 'caries' });
    const t = createTreatment({ name: 'Filling', code: 'FL-01', defaultPricePaisa: 50000 });
    recordTreatment({ patientId: pid, treatmentId: t.id });
    createPrescription({ patientId: pid, items: [{ medicineName: 'Ibuprofen' }] });

    const events = patientTimeline(pid);
    const types = events.map((e) => e.type);
    expect(types).toContain('registration');
    expect(types).toContain('visit');
    expect(types).toContain('chart');
    expect(types).toContain('prescription');
    // newest-first ordering
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].at >= events[i].at).toBe(true);
    }
  });
});
