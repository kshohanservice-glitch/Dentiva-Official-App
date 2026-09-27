/**
 * Print-template tests: pure HTML generation against a real DB (no Electron).
 * Verifies Bengali Unicode round-trips, BDT formatting, paper profiles, and
 * that each document type embeds the clinic header + correct totals.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { freshDb, bootstrapWithAdmin, type TestCtx } from './helpers';
import { getDb } from '../../src/main/db/connection';
import { createPatient } from '../../src/main/services/patients';
import { createPrescription } from '../../src/main/services/prescriptions';
import { createInvoice, recordPayment } from '../../src/main/services/invoices';
import {
  prescriptionHtml,
  invoiceHtml,
  receiptHtml,
  accountingReportHtml,
  escapeHtml,
  PAPER_SIZES,
  fontsDir,
} from '../../src/main/print/templates';
import fs from 'node:fs';
import path from 'node:path';

let ctx: TestCtx;
afterEach(() => ctx?.cleanup());

function newPatient(name = 'রোগী টেস্ট') {
  return createPatient({
    fullName: name,
    phone: `+880171${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`,
  }).id;
}

function cashMethod(): number {
  return getDb().prepare("SELECT id FROM payment_methods WHERE name = 'Cash'").get<{ id: number }>()!.id;
}

function dentistId(): number {
  return getDb().prepare('SELECT id FROM dentists LIMIT 1').get<{ id: number }>()!.id;
}

describe('print template helpers', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`a <b> & "c"`)).toBe('a &lt;b&gt; &amp; &quot;c&quot;');
  });

  it('exposes the four paper profiles', () => {
    expect(Object.keys(PAPER_SIZES).sort()).toEqual(['a4', 'a5', 'mini', 'thermal80']);
  });

  it('resolves a fonts directory that contains Noto Sans Bengali', () => {
    const dir = fontsDir();
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'NotoSansBengali-400.woff2'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'Inter-400.woff2'))).toBe(true);
  });
});

describe('prescription HTML', () => {
  it('renders Bengali clinical text, medicine names, and Rx number', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient('ডাক্তার রোগী');
    const did = dentistId();
    const { id, rxNo } = createPrescription({
      patientId: pid,
      dentistId: did,
      chiefComplaint: 'দাঁতের ব্যথা',
      onExamination: 'ব্যবস্থা পরীক্ষা',
      advice: 'ঔষধ ঠিকমতো খাবেন',
      items: [
        {
          medicineName: 'অ্যামোক্সিসিলিন',
          form: 'Capsule',
          strength: '500 mg',
          dose: '1',
          morning: true,
          night: true,
          afterFood: true,
          duration: '৫ দিন',
        },
        {
          medicineName: 'প্যারাসিটামল',
          form: 'Tablet',
          strength: '500 mg',
          prn: true,
          instructions: 'জ্বর হলে',
        },
      ],
    });

    const html = prescriptionHtml(id, 'a4');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('lang="bn"');
    expect(html).toContain(rxNo);
    expect(html).toContain('ডাক্তার রোগী');
    expect(html).toContain('দাঁতের ব্যথা');
    expect(html).toContain('অ্যামোক্সিসিলিন');
    expect(html).toContain('প্যারাসিটামল');
    expect(html).toContain('ঔষধ ঠিকমতো খাবেন');
    expect(html).toContain('Noto Sans Bengali');
    expect(html).toContain('@font-face');
    expect(html).toContain('Test Dental Care'); // clinic header from setup
    expect(html).toContain('210mm'); // A4 width
  });

  it('adapts CSS page size for thermal paper', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const { id } = createPrescription({
      patientId: pid,
      items: [{ medicineName: 'Med', form: 'Tablet' }],
    });
    const html = prescriptionHtml(id, 'thermal80');
    expect(html).toContain('80mm');
  });
});

describe('invoice + receipt HTML', () => {
  it('renders BDT totals with ৳ and outstanding balance', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient('Billing Patient');
    const inv = createInvoice({
      patientId: pid,
      items: [
        { description: 'স্কেলিং', quantity: 1, unitPricePaisa: 150000 },
        { description: 'Filling', quantity: 2, unitPricePaisa: 50000 },
      ],
      discountPaisa: 10000,
      taxPaisa: 0,
    });
    // subtotal = 150000 + 100000 = 250000; grand = 240000
    expect(inv.grandTotalPaisa).toBe(240000);

    const html = invoiceHtml(inv.id, 'a4');
    expect(html).toContain(inv.invoiceNo);
    expect(html).toContain('স্কেলিং');
    expect(html).toContain('Billing Patient');
    expect(html).toMatch(/৳\s*2,?400\.00|৳\s*2400\.00/);
    expect(html).toContain('Outstanding');
    expect(html).toContain('Noto Sans Bengali');

    const pay = recordPayment({
      invoiceId: inv.id,
      amountPaisa: 100000,
      methodId: cashMethod(),
    });
    const receipt = receiptHtml(pay.id, 'thermal80');
    expect(receipt).toContain(pay.receiptNo);
    expect(receipt).toContain('Payment Receipt');
    expect(receipt).toMatch(/৳\s*1,?000\.00|৳\s*1000\.00/);
    expect(receipt).toContain('ধন্যবাদ');
    expect(receipt).toContain('80mm');
  });
});

describe('accounting report HTML', () => {
  it('renders range totals after a paid invoice', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const inv = createInvoice({
      patientId: pid,
      items: [{ description: 'Consult', unitPricePaisa: 50000 }],
    });
    recordPayment({ invoiceId: inv.id, amountPaisa: 50000, methodId: cashMethod() });

    const today = new Date().toISOString().slice(0, 10);
    const html = accountingReportHtml(today, today, 'a4');
    expect(html).toContain('Accounting Report');
    expect(html).toContain(today);
    expect(html).toContain('Total income');
    expect(html).toContain('Net income');
    expect(html).toMatch(/৳/);
  });
});
