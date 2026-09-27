/**
 * Accounting: income & expense entries against categories, plus aggregate reports.
 * Treatment/consultation income from invoices/payments is reported directly from
 * those tables (real data), never duplicated.
 */
import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso, isValidDateOnly } from '../../shared/datetime';
import { audit } from './audit';

export interface EntryInput {
  categoryId: number;
  amountPaisa: number;
  entryDate: string;
  methodId?: number | null;
  description?: string;
  party?: string; // payer (income) or vendor (expense)
  reference?: string;
}

function validateEntry(input: EntryInput): void {
  if (!Number.isInteger(input.amountPaisa) || input.amountPaisa <= 0) throw new ValidationError('Amount must be a positive value.');
  if (!isValidDateOnly(input.entryDate)) throw new ValidationError('Date must be YYYY-MM-DD.');
}

export function addIncome(input: EntryInput): { id: number } {
  sessionManager.ensurePermission('income.create');
  validateEntry(input);
  const db = getDb();
  if (!db.prepare('SELECT id FROM income_categories WHERE id = ? AND is_active = 1').get(input.categoryId)) {
    throw new ValidationError('Income category not found.');
  }
  const me = sessionManager.currentUser();
  const res = db
    .prepare(
      `INSERT INTO income_entries (category_id, amount_paisa, entry_date, method_id, description, payer, reference, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.categoryId, input.amountPaisa, input.entryDate, input.methodId ?? null, input.description?.trim() ?? '', input.party?.trim() ?? '', input.reference?.trim() ?? '', me.userId, nowIso(), nowIso());
  audit({ action: 'income.created', entity: 'income_entry', entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid };
}

export function addExpense(input: EntryInput): { id: number } {
  sessionManager.ensurePermission('expenses.create');
  validateEntry(input);
  const db = getDb();
  if (!db.prepare('SELECT id FROM expense_categories WHERE id = ? AND is_active = 1').get(input.categoryId)) {
    throw new ValidationError('Expense category not found.');
  }
  const me = sessionManager.currentUser();
  const res = db
    .prepare(
      `INSERT INTO expense_entries (category_id, amount_paisa, entry_date, method_id, description, vendor, reference, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.categoryId, input.amountPaisa, input.entryDate, input.methodId ?? null, input.description?.trim() ?? '', input.party?.trim() ?? '', input.reference?.trim() ?? '', me.userId, nowIso(), nowIso());
  audit({ action: 'expense.created', entity: 'expense_entry', entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid };
}

export function listEntries(kind: 'income' | 'expense', opts: { from?: string; to?: string; categoryId?: number; page: number; pageSize: number }) {
  sessionManager.ensurePermission('accounting.view');
  const table = kind === 'income' ? 'income_entries' : 'expense_entries';
  const partyCol = kind === 'income' ? 'payer' : 'vendor';
  const db = getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.from) {
    where.push('e.entry_date >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('e.entry_date <= ?');
    params.push(opts.to);
  }
  if (opts.categoryId) {
    where.push('e.category_id = ?');
    params.push(opts.categoryId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM ${table} e ${whereSql}`).get<{ c: number }>(...params)?.c ?? 0;
  const pageSize = Math.min(200, Math.max(10, opts.pageSize));
  const rows = db
    .prepare(
      `SELECT e.*, c.name AS category_name, e.${partyCol} AS party, pm.name AS method_name
       FROM ${table} e JOIN ${kind}_categories c ON c.id = e.category_id LEFT JOIN payment_methods pm ON pm.id = e.method_id
       ${whereSql} ORDER BY e.entry_date DESC, e.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (Math.max(1, opts.page) - 1) * pageSize);
  return { total, rows };
}

export function updateEntry(kind: 'income' | 'expense', id: number, input: Partial<EntryInput>): void {
  sessionManager.ensurePermission(kind === 'income' ? 'income.edit' : 'expenses.edit');
  const table = kind === 'income' ? 'income_entries' : 'expense_entries';
  const partyCol = kind === 'income' ? 'payer' : 'vendor';
  const db = getDb();
  const cur = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get<Record<string, string | number | null>>(id);
  if (!cur) throw new NotFoundError('Entry');
  const amount = input.amountPaisa ?? Number(cur.amount_paisa);
  const date = input.entryDate ?? String(cur.entry_date);
  if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('Amount must be a positive value.');
  if (!isValidDateOnly(date)) throw new ValidationError('Date must be YYYY-MM-DD.');
  db.prepare(`UPDATE ${table} SET category_id = ?, amount_paisa = ?, entry_date = ?, method_id = ?, description = ?, ${partyCol} = ?, reference = ?, updated_at = ? WHERE id = ?`).run(
    input.categoryId ?? Number(cur.category_id),
    amount,
    date,
    input.methodId !== undefined ? input.methodId : cur.method_id,
    input.description ?? String(cur.description),
    input.party ?? String(cur[partyCol]),
    input.reference ?? String(cur.reference),
    nowIso(),
    id,
  );
  audit({ action: `${kind}.updated`, entity: `${kind}_entry`, entityId: id });
}

export function deleteEntry(kind: 'income' | 'expense', id: number): void {
  sessionManager.ensurePermission(kind === 'income' ? 'income.delete' : 'expenses.delete');
  const table = kind === 'income' ? 'income_entries' : 'expense_entries';
  const res = getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  if (!res.changes) throw new NotFoundError('Entry');
  audit({ action: `${kind}.deleted`, entity: `${kind}_entry`, entityId: id });
}

export function listCategories(kind: 'income' | 'expense') {
  sessionManager.ensurePermission('accounting.view');
  return getDb().prepare(`SELECT * FROM ${kind}_categories ORDER BY is_system DESC, name ASC`).all();
}

export function addCategory(kind: 'income' | 'expense', name: string): { id: number } {
  sessionManager.ensurePermission('settings.manage');
  if (!name.trim()) throw new ValidationError('Category name is required.');
  const db = getDb();
  if (db.prepare(`SELECT id FROM ${kind}_categories WHERE name = ? COLLATE NOCASE`).get(name.trim())) {
    throw new ValidationError('A category with this name already exists.');
  }
  const res = db.prepare(`INSERT INTO ${kind}_categories (name, is_system, is_active) VALUES (?, 0, 1)`).run(name.trim());
  audit({ action: `${kind}_category.created`, entity: `${kind}_category`, entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid };
}

// --- reports -------------------------------------------------------------------

export interface ReportRange {
  from: string; // YYYY-MM-DD
  to: string;
}

function assertRange(r: ReportRange): void {
  if (!isValidDateOnly(r.from) || !isValidDateOnly(r.to)) throw new ValidationError('Report range must be YYYY-MM-DD dates.');
  if (r.from > r.to) throw new ValidationError('Report "from" date must be before "to" date.');
}

/** Full accounting report — every figure aggregated from real rows. */
export function accountingReport(range: ReportRange) {
  sessionManager.ensurePermission('reports.view');
  assertRange(range);
  const db = getDb();

  const payments = db
    .prepare(
      `SELECT COALESCE(SUM(amount_paisa),0) AS total,
        COALESCE(SUM(CASE WHEN pm.kind='cash' THEN amount_paisa END),0) AS cash,
        COALESCE(SUM(CASE WHEN pm.kind='bank' THEN amount_paisa END),0) AS bank,
        COALESCE(SUM(CASE WHEN pm.kind='card' THEN amount_paisa END),0) AS card,
        COALESCE(SUM(CASE WHEN pm.kind='mobile_wallet' THEN amount_paisa END),0) AS mobile_wallet,
        COALESCE(SUM(CASE WHEN pm.kind='other' THEN amount_paisa END),0) AS other
       FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
       WHERE date(p.paid_at) >= ? AND date(p.paid_at) <= ?`,
    )
    .get(range.from, range.to) as Record<string, number>;

  const otherIncome = db
    .prepare('SELECT COALESCE(SUM(amount_paisa),0) AS s FROM income_entries WHERE entry_date >= ? AND entry_date <= ?')
    .get<{ s: number }>(range.from, range.to)!.s;

  const expenses = db
    .prepare('SELECT COALESCE(SUM(amount_paisa),0) AS s FROM expense_entries WHERE entry_date >= ? AND entry_date <= ?')
    .get<{ s: number }>(range.from, range.to)!.s;

  const expenseByCategory = db
    .prepare(
      `SELECT c.name AS category, COALESCE(SUM(e.amount_paisa),0) AS total
       FROM expense_entries e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.entry_date >= ? AND e.entry_date <= ? GROUP BY c.id ORDER BY total DESC`,
    )
    .all(range.from, range.to);

  const incomeByCategory = db
    .prepare(
      `SELECT c.name AS category, COALESCE(SUM(e.amount_paisa),0) AS total
       FROM income_entries e JOIN income_categories c ON c.id = e.category_id
       WHERE e.entry_date >= ? AND e.entry_date <= ? GROUP BY c.id ORDER BY total DESC`,
    )
    .all(range.from, range.to);

  const treatmentRevenue = db
    .prepare(
      `SELECT COALESCE(SUM(tr.price_paisa),0) AS s FROM treatment_records tr
       WHERE date(tr.created_at) >= ? AND date(tr.created_at) <= ? AND tr.status = 'completed'`,
    )
    .get<{ s: number }>(range.from, range.to)!.s;

  const outstanding = db
    .prepare("SELECT COALESCE(SUM(grand_total_paisa - paid_paisa),0) AS s FROM invoices WHERE status IN ('partial','unpaid') AND deleted_at IS NULL")
    .get<{ s: number }>()!.s;

  const invoiced = db
    .prepare('SELECT COALESCE(SUM(grand_total_paisa),0) AS s FROM invoices WHERE date(invoice_date) >= ? AND date(invoice_date) <= ? AND status != ?')
    .get<{ s: number }>(range.from, range.to, 'void')!.s;

  const daily = db
    .prepare(
      `SELECT d.day, COALESCE(inc.s,0) AS income_paisa, COALESCE(exp.s,0) AS expense_paisa
       FROM (
         SELECT date(paid_at) AS day FROM payments WHERE date(paid_at) >= ? AND date(paid_at) <= ?
         UNION SELECT entry_date FROM income_entries WHERE entry_date >= ? AND entry_date <= ?
         UNION SELECT entry_date FROM expense_entries WHERE entry_date >= ? AND entry_date <= ?
       ) d
       LEFT JOIN (SELECT date(paid_at) AS day, SUM(amount_paisa) AS s FROM payments GROUP BY day) inc ON inc.day = d.day
       LEFT JOIN (SELECT entry_date AS day, SUM(amount_paisa) AS s FROM expense_entries GROUP BY day) exp ON exp.day = d.day
       ORDER BY d.day ASC`,
    )
    .all(range.from, range.to, range.from, range.to, range.from, range.to);

  const totalIncome = payments.total + otherIncome;
  return {
    range,
    treatmentIncomePaisa: payments.total, // cash actually received (treatments/payments)
    otherIncomePaisa: otherIncome,
    totalIncomePaisa: totalIncome,
    totalExpensePaisa: expenses,
    netIncomePaisa: totalIncome - expenses,
    invoicedPaisa: invoiced,
    outstandingPaisa: outstanding,
    treatmentValuePaisa: treatmentRevenue,
    byMethod: {
      cash: payments.cash,
      bank: payments.bank,
      card: payments.card,
      mobileWallet: payments.mobile_wallet,
      other: payments.other,
    },
    expenseByCategory,
    incomeByCategory,
    daily,
  };
}
