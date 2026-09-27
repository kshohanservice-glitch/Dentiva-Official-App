import { afterEach, describe, expect, it } from 'vitest';
import { freshDb, bootstrapWithAdmin, type TestCtx } from './helpers';
import { getDb } from '../../src/main/db/connection';
import {
  createPatient, getPatient, listPatients, updatePatient, deletePatient,
  setPatientPinned, setPatientStatus, searchPatientsForPicker,
} from '../../src/main/services/patients';
import { ValidationError, AppError } from '../../src/main/util/errors';

let ctx: TestCtx;
afterEach(() => ctx?.cleanup());

const base = {
  fullName: 'Rahim Uddin',
  age: 34,
  gender: 'male',
  bloodGroup: 'B+',
  address: 'Mirpur, Dhaka',
  phone: '+8801711111111',
};

describe('patient management', () => {
  it('creates patients with auto-generated unique codes', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const a = createPatient({ ...base });
    const b = createPatient({ ...base, fullName: 'Karim Mia', phone: '+8801722222222' });
    expect(a.patientCode).toMatch(/^P-\d{6}$/);
    expect(b.patientCode).not.toBe(a.patientCode);
    const p = getPatient(a.id);
    expect(p).toMatchObject({ full_name: 'Rahim Uddin', gender: 'male' });
    expect((p as { summary: { totalVisits: number } }).summary.totalVisits).toBe(0);
  });

  it('accepts Bengali names and round-trips them exactly', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const bn = 'মোঃ আব্দুল করিম';
    const addr = 'গ্রাম: চরফ্যাশন, ভোলা';
    const { id } = createPatient({ fullName: bn, address: addr, phone: '+8801733333333' });
    const p = getPatient(id);
    expect(p.full_name).toBe(bn);
    expect(p.address).toBe(addr);
    // search finds Bengali text
    const list = listPatients({ search: 'আব্দুল', page: 1, pageSize: 10 });
    expect(list.total).toBe(1);
  });

  it('rejects duplicate explicit codes', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    createPatient({ ...base, patientCode: 'CUSTOM-1' });
    expect(() => createPatient({ ...base, fullName: 'Other', patientCode: 'CUSTOM-1', phone: '+8801744444444' })).toThrow(ValidationError);
  });

  it('rejects invalid input', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    expect(() => createPatient({ fullName: '' })).toThrow(ValidationError);
    expect(() => createPatient({ fullName: 'X', age: 200 })).toThrow(ValidationError);
    expect(() => createPatient({ fullName: 'X', gender: 'alien' })).toThrow(ValidationError);
    expect(() => createPatient({ fullName: 'X', phone: 'abc' })).toThrow(ValidationError);
  });

  it('detects likely duplicates (same name + phone)', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    createPatient({ ...base });
    expect(() => createPatient({ ...base })).toThrow(/already exists/);
  });

  it('updates patients and keeps code stable unless changed', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const { id, patientCode } = createPatient({ ...base });
    updatePatient(id, { notes: 'Allergic to penicillin' });
    const p = getPatient(id);
    expect(p.patient_code).toBe(patientCode);
    expect(p.notes).toBe('Allergic to penicillin');
    expect(() => updatePatient(id, { fullName: '' })).toThrow(ValidationError);
  });

  it('filters by date preset and search, newest first', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    createPatient({ fullName: 'Patient One', phone: '+8801710000001' });
    createPatient({ fullName: 'Patient Two', phone: '+8801710000002' });
    const all = listPatients({ preset: 'today', page: 1, pageSize: 10 });
    expect(all.total).toBe(2);
    expect(all.rows[0].full_name).toBe('Patient Two'); // newest first
    const none = listPatients({ preset: '7d', page: 1, pageSize: 10, search: 'zzzz-no-match' });
    expect(none.total).toBe(0);
  });

  it('pins and archives patients', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const { id } = createPatient({ ...base });
    setPatientPinned(id, true);
    expect(getPatient(id).is_pinned).toBe(1);
    setPatientStatus(id, 'archived');
    expect(getPatient(id).status).toBe('archived');
  });

  it('soft-deletes with typed confirmation, blocks deletion when invoices exist', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const { id, patientCode } = createPatient({ ...base });
    expect(() => deletePatient(id, 'WRONG')).toThrow(/Confirmation/);
    deletePatient(id, patientCode);
    expect(() => getPatient(id)).toThrow(); // gone from normal queries
    const list = listPatients({ preset: 'all', page: 1, pageSize: 10 });
    expect(list.total).toBe(0);

    // patient with an invoice cannot be deleted
    const db = getDb();
    const { id: id2, patientCode: code2 } = createPatient({ fullName: 'Billed Patient', phone: '+8801799999999' });
    db.prepare("INSERT INTO invoices (invoice_no, patient_id, invoice_date, subtotal_paisa, discount_paisa, tax_paisa, grand_total_paisa, paid_paisa, status, created_at, updated_at) VALUES ('INV-T1', ?, datetime('now'), 10000, 0, 0, 10000, 0, 'unpaid', datetime('now'), datetime('now'))").run(id2);
    expect(() => deletePatient(id2, code2)).toThrow(AppError);
  });

  it('picker search returns top matches', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    createPatient({ fullName: 'Sadia Islam', phone: '+8801755555555' });
    const hits = searchPatientsForPicker('sadia');
    expect(hits.length).toBe(1);
    expect(hits[0]).toHaveProperty('patient_code');
  });
});
