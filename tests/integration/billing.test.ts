import { afterEach, describe, expect, it } from 'vitest';
import { freshDb, bootstrapWithAdmin, type TestCtx } from './helpers';
import { getDb } from '../../src/main/db/connection';
import { createPatient } from '../../src/main/services/patients';
import { createInvoice, recordPayment, getInvoice, listPayments, voidInvoice } from '../../src/main/services/invoices';
import { ValidationError, AppError } from '../../src/main/util/errors';

let ctx: TestCtx;
afterEach(() => ctx?.cleanup());

function newPatient(name = 'Billing Patient') {
  return createPatient({ fullName: name, phone: `+880171${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}` }).id;
}

function cashMethod(): number {
  return getDb().prepare("SELECT id FROM payment_methods WHERE name = 'Cash'").get<{ id: number }>()!.id;
}

describe('invoice totals (integer paisa)', () => {
  it('computes subtotal - discount + tax exactly', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const res = createInvoice({
      patientId: pid,
      items: [
        { description: 'Scaling', quantity: 1, unitPricePaisa: 150000 },
        { description: 'Filling', quantity: 2, unitPricePaisa: 80050, discountPaisa: 50 },
      ],
      discountPaisa: 10000,
      taxPaisa: 5000,
    });
    // subtotal = 150000 + (80050*2 - 50) = 150000 + 160050 = 310050
    // grand = 310050 - 10000 + 5000 = 305050
    expect(res.grandTotalPaisa).toBe(305050);
    const inv = getInvoice(res.id) as unknown as { subtotal_paisa: number; grand_total_paisa: number; paid_paisa: number; status: string };
    expect(inv.subtotal_paisa).toBe(310050);
    expect(inv.status).toBe('unpaid');
  });

  it('rejects negative or inconsistent amounts', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    expect(() => createInvoice({ patientId: pid, items: [{ description: 'X', unitPricePaisa: -5 }] })).toThrow(ValidationError);
    expect(() => createInvoice({ patientId: pid, items: [{ description: 'X', quantity: 0, unitPricePaisa: 5 }] })).toThrow(ValidationError);
    expect(() => createInvoice({ patientId: pid, items: [{ description: 'X', unitPricePaisa: 100, discountPaisa: 200 }] })).toThrow(ValidationError);
    expect(() => createInvoice({ patientId: pid, items: [{ description: 'X', unitPricePaisa: 100 }], discountPaisa: 200 })).toThrow(ValidationError);
    expect(() => createInvoice({ patientId: pid, items: [] })).toThrow(ValidationError);
  });
});

describe('payments & reconciliation', () => {
  it('partial then final payment flips status and reconciles', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const inv = createInvoice({ patientId: pid, items: [{ description: 'RCT', quantity: 1, unitPricePaisa: 500000 }] });

    const p1 = recordPayment({ invoiceId: inv.id, amountPaisa: 200000, methodId: cashMethod() });
    expect(p1.invoiceStatus).toBe('partial');
    const p2 = recordPayment({ invoiceId: inv.id, amountPaisa: 300000, methodId: cashMethod() });
    expect(p2.invoiceStatus).toBe('paid');

    const after = getInvoice(inv.id) as unknown as { paid_paisa: number; grand_total_paisa: number; status: string };
    expect(after.paid_paisa).toBe(500000);
    expect(after.grand_total_paisa - after.paid_paisa).toBe(0);
    expect(after.status).toBe('paid');
  });

  it('prevents overpayment and non-positive amounts', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const inv = createInvoice({ patientId: pid, items: [{ description: 'Crown', unitPricePaisa: 100000 }] });
    expect(() => recordPayment({ invoiceId: inv.id, amountPaisa: 100001, methodId: cashMethod() })).toThrow(/exceeds/);
    expect(() => recordPayment({ invoiceId: inv.id, amountPaisa: 0, methodId: cashMethod() })).toThrow(ValidationError);
    expect(() => recordPayment({ invoiceId: inv.id, amountPaisa: -100, methodId: cashMethod() })).toThrow(ValidationError);
  });

  it('global invariant: for every invoice grand_total - paid = outstanding', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    for (let i = 0; i < 5; i++) {
      const pid = newPatient(`Invariant ${i}`);
      const inv = createInvoice({ patientId: pid, items: [{ description: `T${i}`, unitPricePaisa: 10000 * (i + 1) }] });
      if (i % 2 === 0) recordPayment({ invoiceId: inv.id, amountPaisa: 5000, methodId: cashMethod() });
    }
    const rows = getDb().prepare('SELECT grand_total_paisa, paid_paisa FROM invoices').all<{ grand_total_paisa: number; paid_paisa: number }>();
    for (const r of rows) {
      expect(r.grand_total_paisa - r.paid_paisa).toBeGreaterThanOrEqual(0);
    }
    // patient-level reconciliation
    const totals = getDb().prepare("SELECT COALESCE(SUM(grand_total_paisa),0) AS billed, COALESCE(SUM(paid_paisa),0) AS paid FROM invoices WHERE status != 'void'").get<{ billed: number; paid: number }>()!;
    const paymentsSum = getDb().prepare('SELECT COALESCE(SUM(amount_paisa),0) AS s FROM payments').get<{ s: number }>()!.s;
    expect(totals.paid).toBe(paymentsSum); // payments ledger matches invoice paid totals
  });

  it('payment list aggregates by method and reports outstanding', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const bkash = getDb().prepare("SELECT id FROM payment_methods WHERE name = 'bKash'").get<{ id: number }>()!.id;
    const inv = createInvoice({ patientId: pid, items: [{ description: 'X', unitPricePaisa: 90000 }] });
    recordPayment({ invoiceId: inv.id, amountPaisa: 40000, methodId: bkash });
    const res = listPayments({ page: 1, pageSize: 10 });
    expect(res.sums.mobile_wallet).toBe(40000);
    expect(res.sums.cash).toBe(0);
    expect(res.outstandingPaisa).toBe(50000);
  });

  it('void rules: cannot void paid invoices; voided invoices refuse payment', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const pid = newPatient();
    const inv = createInvoice({ patientId: pid, items: [{ description: 'X', unitPricePaisa: 10000 }] });
    recordPayment({ invoiceId: inv.id, amountPaisa: 10000, methodId: cashMethod() });
    expect(() => voidInvoice(inv.id, 'mistake')).toThrow(AppError);

    const inv2 = createInvoice({ patientId: pid, items: [{ description: 'Y', unitPricePaisa: 10000 }] });
    voidInvoice(inv2.id, 'wrong patient');
    expect(() => recordPayment({ invoiceId: inv2.id, amountPaisa: 5000, methodId: cashMethod() })).toThrow(/void/);
  });
});
