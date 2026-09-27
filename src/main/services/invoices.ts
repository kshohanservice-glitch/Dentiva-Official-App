/**
 * Invoicing with integer-paisa money, transactional item insertion, and
 * payment/reconciliation invariants:
 *   grand_total = subtotal - discount + tax
 *   grand_total - paid = outstanding
 */
import { getDb, tx } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError, AppError, PermissionDeniedError } from '../util/errors';
import { nowIso } from '../../shared/datetime';
import { audit } from './audit';
import { nextSequence } from './settings';

export interface InvoiceItemInput {
  treatmentId?: number | null;
  description: string;
  quantity?: number;
  unitPricePaisa: number;
  discountPaisa?: number;
}

export interface InvoiceInput {
  patientId: number;
  visitId?: number | null;
  items: InvoiceItemInput[];
  discountPaisa?: number;
  discountReason?: string;
  taxPaisa?: number;
  notes?: string;
  invoiceDate?: string;
}

function computeTotals(items: InvoiceItemInput[], discountPaisa: number, taxPaisa: number) {
  let subtotal = 0;
  for (const it of items) {
    const qty = it.quantity ?? 1;
    if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('Item quantity must be a positive integer.');
    if (!Number.isInteger(it.unitPricePaisa) || it.unitPricePaisa < 0) throw new ValidationError('Item price cannot be negative.');
    const lineDiscount = it.discountPaisa ?? 0;
    if (!Number.isInteger(lineDiscount) || lineDiscount < 0) throw new ValidationError('Item discount cannot be negative.');
    const line = it.unitPricePaisa * qty - lineDiscount;
    if (line < 0) throw new ValidationError('A line discount cannot exceed the line total.');
    subtotal += line;
  }
  if (!Number.isInteger(discountPaisa) || discountPaisa < 0) throw new ValidationError('Invoice discount cannot be negative.');
  if (!Number.isInteger(taxPaisa) || taxPaisa < 0) throw new ValidationError('Tax cannot be negative.');
  if (discountPaisa > subtotal) throw new ValidationError('Invoice discount cannot exceed the subtotal.');
  const grand = subtotal - discountPaisa + taxPaisa;
  return { subtotal, grand };
}

export function createInvoice(input: InvoiceInput): { id: number; invoiceNo: string; grandTotalPaisa: number } {
  sessionManager.ensurePermission('invoices.create');
  const db = getDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ValidationError('Patient not found.');
  if (!Array.isArray(input.items) || input.items.length === 0) throw new ValidationError('An invoice needs at least one line item.');
  for (const it of input.items) {
    if (!it.description?.trim()) throw new ValidationError('Every line item needs a description.');
  }
  const discount = input.discountPaisa ?? 0;
  const tax = input.taxPaisa ?? 0;
  const { subtotal, grand } = computeTotals(input.items, discount, tax);

  const me = sessionManager.currentUser();
  const at = nowIso();
  let out = { id: 0, invoiceNo: '', grandTotalPaisa: grand };
  tx(() => {
    const invoiceNo = nextSequence('next_invoice_no', 'invoice_prefix', 5);
    const res = db
      .prepare(
        `INSERT INTO invoices (invoice_no, patient_id, visit_id, invoice_date, subtotal_paisa, discount_paisa, discount_reason, tax_paisa, grand_total_paisa, paid_paisa, status, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unpaid', ?, ?, ?, ?)`,
      )
      .run(
        invoiceNo,
        input.patientId,
        input.visitId ?? null,
        input.invoiceDate ?? at,
        subtotal,
        discount,
        input.discountReason?.trim() ?? '',
        tax,
        grand,
        input.notes?.trim() ?? '',
        me.userId,
        at,
        at,
      );
    const invId = res.lastInsertRowid;
    const insItem = db.prepare(
      `INSERT INTO invoice_items (invoice_id, treatment_id, description, quantity, unit_price_paisa, discount_paisa, line_total_paisa, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const linkable = db.prepare(
      'SELECT id FROM treatment_records WHERE treatment_id = ? AND patient_id = ? AND invoice_id IS NULL LIMIT 1',
    );
    const linkRecord = db.prepare(
      'UPDATE treatment_records SET invoice_id = ? WHERE id = ? AND invoice_id IS NULL',
    );
    input.items.forEach((it, i) => {
      const qty = it.quantity ?? 1;
      const line = it.unitPricePaisa * qty - (it.discountPaisa ?? 0);
      insItem.run(invId, it.treatmentId ?? null, it.description.trim(), qty, it.unitPricePaisa, it.discountPaisa ?? 0, line, i);
      if (it.treatmentId) {
        // Link one matching un-billed treatment record to this invoice (best effort).
        const rec = linkable.get<{ id: number }>(it.treatmentId, input.patientId);
        if (rec) linkRecord.run(invId, rec.id);
      }
    });
    audit({ action: 'invoice.created', entity: 'invoice', entityId: invId, details: { invoiceNo, grand } });
    out = { id: invId, invoiceNo, grandTotalPaisa: grand };
  });
  return out;
}

export function listInvoices(opts: { patientId?: number; status?: string; preset?: string; from?: string; to?: string; page: number; pageSize: number; search?: string }) {
  sessionManager.ensurePermission('invoices.view');
  const db = getDb();
  const where: string[] = ['i.deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (opts.patientId) {
    where.push('i.patient_id = ?');
    params.push(opts.patientId);
  }
  if (opts.status && opts.status !== 'all') {
    where.push('i.status = ?');
    params.push(opts.status);
  }
  if (opts.from) {
    where.push('date(i.invoice_date) >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('date(i.invoice_date) <= ?');
    params.push(opts.to);
  }
  if (opts.search?.trim()) {
    const s = `%${opts.search.trim()}%`;
    where.push('(i.invoice_no LIKE ? OR pt.full_name LIKE ? OR pt.patient_code LIKE ?)');
    params.push(s, s, s);
  }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM invoices i JOIN patients pt ON pt.id = i.patient_id WHERE ${where.join(' AND ')}`).get<{ c: number }>(...params)?.c ?? 0;
  const pageSize = Math.min(100, Math.max(10, opts.pageSize));
  const rows = db
    .prepare(
      `SELECT i.*, pt.full_name AS patient_name, pt.patient_code
       FROM invoices i JOIN patients pt ON pt.id = i.patient_id
       WHERE ${where.join(' AND ')} ORDER BY i.invoice_date DESC, i.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (Math.max(1, opts.page) - 1) * pageSize);
  return { total, rows };
}

export function getInvoice(id: number) {
  sessionManager.ensurePermission('invoices.view');
  const db = getDb();
  const inv = db
    .prepare(
      `SELECT i.*, pt.full_name AS patient_name, pt.patient_code, pt.phone, pt.address, pt.age, pt.gender
       FROM invoices i JOIN patients pt ON pt.id = i.patient_id WHERE i.id = ? AND i.deleted_at IS NULL`,
    )
    .get(id);
  if (!inv) throw new NotFoundError('Invoice');
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC').all(id);
  const payments = db
    .prepare(
      `SELECT p.*, pm.name AS method_name FROM payments p JOIN payment_methods pm ON pm.id = p.method_id WHERE p.invoice_id = ? ORDER BY p.paid_at ASC`,
    )
    .all(id);
  return { ...inv, items, payments };
}

export function editInvoice(id: number, input: Partial<InvoiceInput>): void {
  sessionManager.ensurePermission('invoices.edit');
  const db = getDb();
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL').get<Record<string, string | number | null>>(id);
  if (!inv) throw new NotFoundError('Invoice');
  if (Number(inv.paid_paisa) > 0) {
    throw new AppError('INVOICE_HAS_PAYMENTS', 'This invoice already has payments recorded. Refund or adjust instead of editing.');
  }
  if (inv.status === 'void') throw new ValidationError('Void invoices cannot be edited.');

  const items: InvoiceItemInput[] =
    input.items ??
    db
      .prepare(
        'SELECT treatment_id AS treatmentId, description, quantity, unit_price_paisa AS unitPricePaisa, discount_paisa AS discountPaisa FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order',
      )
      .all<InvoiceItemInput>(id);
  const discount = input.discountPaisa ?? Number(inv.discount_paisa);
  const tax = input.taxPaisa ?? Number(inv.tax_paisa);
  const { subtotal, grand } = computeTotals(items, discount, tax);

  tx(() => {
    db.prepare(
      'UPDATE invoices SET subtotal_paisa = ?, discount_paisa = ?, discount_reason = ?, tax_paisa = ?, grand_total_paisa = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?',
    ).run(
      subtotal,
      discount,
      input.discountReason ?? String(inv.discount_reason),
      tax,
      grand,
      input.notes ?? String(inv.notes),
      grand === 0 ? 'paid' : 'unpaid',
      nowIso(),
      id,
    );
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id);
    const insItem = db.prepare(
      'INSERT INTO invoice_items (invoice_id, treatment_id, description, quantity, unit_price_paisa, discount_paisa, line_total_paisa, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    items.forEach((it, i) => {
      const qty = it.quantity ?? 1;
      insItem.run(id, it.treatmentId ?? null, it.description.trim(), qty, it.unitPricePaisa, it.discountPaisa ?? 0, it.unitPricePaisa * qty - (it.discountPaisa ?? 0), i);
    });
    audit({ action: 'invoice.updated', entity: 'invoice', entityId: id, details: { grand } });
  });
}

export function voidInvoice(id: number, reason: string): void {
  sessionManager.ensurePermission('invoices.delete');
  const db = getDb();
  const inv = db.prepare('SELECT paid_paisa FROM invoices WHERE id = ? AND deleted_at IS NULL').get<{ paid_paisa: number }>(id);
  if (!inv) throw new NotFoundError('Invoice');
  if (inv.paid_paisa > 0) {
    throw new AppError('INVOICE_HAS_PAYMENTS', 'An invoice with payments cannot be voided. Process a refund first.');
  }
  db.prepare("UPDATE invoices SET status = 'void', voided_at = ?, notes = notes || CHAR(10) || ('Voided: ' || ?), updated_at = ? WHERE id = ?").run(
    nowIso(),
    reason?.trim() || 'no reason given',
    nowIso(),
    id,
  );
  audit({ action: 'invoice.voided', entity: 'invoice', entityId: id });
}

// --- payments -----------------------------------------------------------------

export interface PaymentInput {
  invoiceId: number;
  amountPaisa: number;
  methodId: number;
  reference?: string;
  notes?: string;
  paidAt?: string;
}

export function recordPayment(input: PaymentInput): { id: number; receiptNo: string; invoiceStatus: string } {
  sessionManager.ensurePermission('payments.record');
  if (!Number.isInteger(input.amountPaisa) || input.amountPaisa <= 0) {
    throw new ValidationError('Payment amount must be a positive value.');
  }
  const db = getDb();
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL').get<Record<string, string | number>>(input.invoiceId);
  if (!inv) throw new NotFoundError('Invoice');
  if (inv.status === 'void') throw new ValidationError('Cannot take payment against a void invoice.');
  const outstanding = Number(inv.grand_total_paisa) - Number(inv.paid_paisa);
  if (input.amountPaisa > outstanding) {
    throw new ValidationError(`Payment exceeds the outstanding balance (overpayment is not allowed). Outstanding: ${(outstanding / 100).toFixed(2)} BDT.`);
  }
  const method = db.prepare('SELECT id FROM payment_methods WHERE id = ? AND is_active = 1').get(input.methodId);
  if (!method) throw new ValidationError('Payment method not found.');

  const me = sessionManager.currentUser();
  const at = nowIso();
  let out = { id: 0, receiptNo: '', invoiceStatus: '' };
  tx(() => {
    const receiptNo = nextSequence('next_receipt_no', 'receipt_prefix', 5);
    const res = db
      .prepare(
        `INSERT INTO payments (receipt_no, invoice_id, patient_id, amount_paisa, method_id, reference, notes, paid_at, received_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receiptNo,
        input.invoiceId,
        Number(inv.patient_id),
        input.amountPaisa,
        input.methodId,
        input.reference?.trim() ?? '',
        input.notes?.trim() ?? '',
        input.paidAt ?? at,
        me.userId,
        at,
      );
    const newPaid = Number(inv.paid_paisa) + input.amountPaisa;
    const status = newPaid >= Number(inv.grand_total_paisa) ? 'paid' : 'partial';
    db.prepare('UPDATE invoices SET paid_paisa = ?, status = ?, updated_at = ? WHERE id = ?').run(newPaid, status, at, input.invoiceId);
    audit({ action: 'payment.recorded', entity: 'payment', entityId: res.lastInsertRowid, details: { receiptNo, amount: input.amountPaisa } });
    out = { id: res.lastInsertRowid, receiptNo, invoiceStatus: status };
  });
  return out;
}

export function listPayments(opts: { preset?: string; from?: string; to?: string; methodId?: number; page: number; pageSize: number }) {
  sessionManager.ensurePermission('payments.view');
  const db = getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.from) {
    where.push('date(p.paid_at) >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('date(p.paid_at) <= ?');
    params.push(opts.to);
  }
  if (opts.methodId) {
    where.push('p.method_id = ?');
    params.push(opts.methodId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM payments p ${whereSql}`).get<{ c: number }>(...params)?.c ?? 0;
  const pageSize = Math.min(200, Math.max(10, opts.pageSize));
  const rows = db
    .prepare(
      `SELECT p.*, pm.name AS method_name, pt.full_name AS patient_name, i.invoice_no
       FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
       JOIN patients pt ON pt.id = p.patient_id JOIN invoices i ON i.id = p.invoice_id
       ${whereSql} ORDER BY p.paid_at DESC, p.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (Math.max(1, opts.page) - 1) * pageSize);

  // Aggregates for the payments dashboard
  const sums = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_paisa),0) AS total,
              COALESCE(SUM(CASE WHEN pm.kind = 'cash' THEN p.amount_paisa END),0) AS cash,
              COALESCE(SUM(CASE WHEN pm.kind = 'bank' THEN p.amount_paisa END),0) AS bank,
              COALESCE(SUM(CASE WHEN pm.kind = 'card' THEN p.amount_paisa END),0) AS card,
              COALESCE(SUM(CASE WHEN pm.kind = 'mobile_wallet' THEN p.amount_paisa END),0) AS mobile_wallet,
              COALESCE(SUM(CASE WHEN pm.kind = 'other' THEN p.amount_paisa END),0) AS other
       FROM payments p JOIN payment_methods pm ON pm.id = p.method_id ${whereSql}`,
    )
    .get(...params) as Record<string, number>;
  const outstanding = db
    .prepare("SELECT COALESCE(SUM(grand_total_paisa - paid_paisa),0) AS s FROM invoices WHERE status IN ('partial','unpaid') AND deleted_at IS NULL")
    .get<{ s: number }>()!.s;
  return { total, rows, sums, outstandingPaisa: outstanding };
}

export function listPaymentMethods() {
  // No permission gate: needed to render payment forms anywhere the user can bill.
  if (!sessionManager.hasSession() || sessionManager.isLocked()) throw new PermissionDeniedError();
  return getDb().prepare('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY sort_order ASC').all();
}
