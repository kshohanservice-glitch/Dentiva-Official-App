import { afterEach, describe, expect, it } from 'vitest';
import { freshDb, bootstrapWithAdmin, type TestCtx } from './helpers';
import { getDb } from '../../src/main/db/connection';
import {
  createInventoryItem, listInventory, stockMovement, stockLedger, inventoryAlerts, retireInventoryItem, upsertSupplier, listSuppliers,
} from '../../src/main/services/inventory';
import {
  addIncome, addExpense, listEntries, accountingReport, listCategories, addCategory,
} from '../../src/main/services/accounting';
import { ValidationError } from '../../src/main/util/errors';
import { todayLocal } from '../../src/shared/datetime';

let ctx: TestCtx;
afterEach(() => ctx?.cleanup());

describe('inventory', () => {
  it('creates items with opening stock ledger entry', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const { id } = createInventoryItem({ name: 'Gloves (pair)', sku: 'GLV-01', category: 'PPE', openingStock: 100, minStock: 20, purchaseCostPaisa: 1500 });
    const items = listInventory({}) as Array<{ id: number; current_stock: number; sku: string }>;
    const item = items.find((i) => i.id === id)!;
    expect(item.current_stock).toBe(100);
    const ledger = stockLedger(id) as Array<{ txn_type: string; quantity: number; reason: string }>;
    expect(ledger[0]).toMatchObject({ txn_type: 'in', quantity: 100, reason: 'Opening stock' });
    expect(() => createInventoryItem({ name: 'X', sku: 'GLV-01' })).toThrow(/already exists/);
  });

  it('ledger invariant: opening + in - out ± adjust = current stock', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const { id } = createInventoryItem({ name: 'Composite', sku: 'CMP-01', openingStock: 50 });
    stockMovement({ itemId: id, type: 'in', quantity: 30, batchNo: 'B2', unitCostPaisa: 90000 });
    stockMovement({ itemId: id, type: 'out', quantity: 25, reason: 'Used in procedures' });
    stockMovement({ itemId: id, type: 'adjust', quantity: -3, reason: 'Damaged' });
    const item = getDb().prepare('SELECT current_stock FROM inventory_items WHERE id = ?').get<{ current_stock: number }>(id)!;
    expect(item.current_stock).toBe(50 + 30 - 25 - 3);

    const ledger = stockLedger(id) as Array<{ quantity: number }>;
    expect(ledger).toHaveLength(4);
    // ledger is immutable history — count never decreases with movements
    expect(() => stockMovement({ itemId: id, type: 'out', quantity: 10000 })).toThrow(/below zero/);
    expect(() => stockMovement({ itemId: id, type: 'in', quantity: 0 })).toThrow(ValidationError);
  });

  it('low-stock and expiry alerts fire from real data', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    createInventoryItem({ name: 'Low item', sku: 'LOW-1', openingStock: 2, minStock: 5 });
    createInventoryItem({ name: 'Expiring item', sku: 'EXP-1', openingStock: 10, expiryDate: '2026-10-05' });
    createInventoryItem({ name: 'Expired item', sku: 'EXPD-1', openingStock: 10, expiryDate: '2020-01-01' });
    const alerts = inventoryAlerts();
    expect((alerts.low as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((alerts.expired as unknown[]).length).toBeGreaterThanOrEqual(1);
    const lowRows = listInventory({ lowOnly: true }) as Array<{ sku: string }>;
    expect(lowRows.some((r) => r.sku === 'LOW-1')).toBe(true);
  });

  it('suppliers and retire flow', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const s = upsertSupplier({ name: 'Dental Depot BD', phone: '+8801900000000' });
    expect((listSuppliers() as Array<{ id: number }>).some((x) => x.id === s.id)).toBe(true);
    const { id } = createInventoryItem({ name: 'Burs', sku: 'BUR-1', supplierId: s.id, openingStock: 10 });
    retireInventoryItem(id);
    const rows = listInventory({}) as Array<{ id: number }>;
    expect(rows.some((r) => r.id === id)).toBe(false);
  });
});

describe('accounting', () => {
  it('income/expense entries with categories; net income reconciles', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const incCats = listCategories('income') as Array<{ id: number; name: string }>;
    const expCats = listCategories('expense') as Array<{ id: number; name: string }>;
    const consult = incCats.find((c) => c.name === 'Consultation Fee')!.id;
    const rent = expCats.find((c) => c.name === 'Rent')!.id;
    const today = todayLocal();

    addIncome({ categoryId: consult, amountPaisa: 500000, entryDate: today, description: 'Consultations' });
    addExpense({ categoryId: rent, amountPaisa: 200000, entryDate: today, party: 'Landlord' });
    expect(() => addExpense({ categoryId: rent, amountPaisa: -5, entryDate: today })).toThrow(ValidationError);
    expect(() => addExpense({ categoryId: rent, amountPaisa: 5, entryDate: 'bad-date' })).toThrow(ValidationError);

    const list = listEntries('expense', { page: 1, pageSize: 10 });
    expect(list.total).toBe(1);

    // custom category
    const custom = addCategory('expense', 'Software License');
    addExpense({ categoryId: custom.id, amountPaisa: 100000, entryDate: today });

    const report = accountingReport({ from: today, to: today });
    expect(report.otherIncomePaisa).toBe(500000);
    expect(report.totalExpensePaisa).toBe(300000);
    expect(report.netIncomePaisa).toBe(report.totalIncomePaisa - report.totalExpensePaisa);
    expect((report.expenseByCategory as Array<{ category: string; total: number }>).find((r) => r.category === 'Rent')?.total).toBe(200000);
  });

  it('report rejects bad ranges', () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    expect(() => accountingReport({ from: '2026-02-02', to: '2026-01-01' })).toThrow(ValidationError);
    expect(() => accountingReport({ from: 'junk', to: 'junk' })).toThrow(ValidationError);
  });
});
