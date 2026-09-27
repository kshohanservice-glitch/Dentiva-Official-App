/**
 * Inventory: items, batches (expiry/batch no.), immutable transaction ledger,
 * low-stock & expiry alerts. Stock movements are never deleted.
 */
import { getDb, tx } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso, isValidDateOnly, addDays, todayLocal } from '../../shared/datetime';
import { audit } from './audit';
import { getSettingInt } from './settings';

export interface InventoryItemInput {
  name: string;
  sku: string;
  category?: string;
  supplierId?: number | null;
  unit?: string;
  purchaseCostPaisa?: number;
  sellingCostPaisa?: number;
  openingStock?: number;
  minStock?: number;
  expiryDate?: string | null;
  batchNo?: string;
  notes?: string;
}

export function listInventory(opts: { search?: string; lowOnly?: boolean; expiringOnly?: boolean }) {
  sessionManager.ensurePermission('inventory.view');
  const db = getDb();
  const where: string[] = ['i.is_active = 1'];
  const params: (string | number)[] = [];
  if (opts.search?.trim()) {
    const s = `%${opts.search.trim()}%`;
    where.push('(i.name LIKE ? OR i.sku LIKE ? OR i.category LIKE ?)');
    params.push(s, s, s);
  }
  if (opts.lowOnly) where.push('i.current_stock <= i.min_stock');
  if (opts.expiringOnly) {
    where.push("i.expiry_date IS NOT NULL AND i.expiry_date != '' AND date(i.expiry_date) <= date('now', '+' || ? || ' days')");
    params.push(getSettingInt('expiry_warning_days', 30));
  }
  return db
    .prepare(
      `SELECT i.*, s.name AS supplier_name FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE ${where.join(' AND ')} ORDER BY i.name ASC`,
    )
    .all(...params);
}

export function createInventoryItem(input: InventoryItemInput): { id: number } {
  sessionManager.ensurePermission('inventory.manage');
  if (!input.name?.trim()) throw new ValidationError('Item name is required.');
  if (!input.sku?.trim()) throw new ValidationError('SKU / code is required.');
  const db = getDb();
  if (db.prepare('SELECT id FROM inventory_items WHERE sku = ?').get(input.sku.trim())) {
    throw new ValidationError(`SKU "${input.sku.trim()}" already exists.`);
  }
  if (input.expiryDate && !isValidDateOnly(input.expiryDate)) throw new ValidationError('Expiry date must be YYYY-MM-DD.');
  const opening = input.openingStock ?? 0;
  if (opening < 0) throw new ValidationError('Opening stock cannot be negative.');
  const me = sessionManager.currentUser();
  const at = nowIso();
  let id = 0;
  tx(() => {
    const res = db
      .prepare(
        `INSERT INTO inventory_items (name, sku, category, supplier_id, unit, purchase_cost_paisa, selling_cost_paisa, current_stock, min_stock, expiry_date, notes, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        input.name.trim(),
        input.sku.trim(),
        input.category?.trim() ?? '',
        input.supplierId ?? null,
        input.unit?.trim() || 'pcs',
        input.purchaseCostPaisa ?? 0,
        input.sellingCostPaisa ?? 0,
        opening,
        input.minStock ?? getSettingInt('low_stock_threshold_default', 5),
        input.expiryDate ?? null,
        input.notes?.trim() ?? '',
        at,
        at,
      );
    id = res.lastInsertRowid;
    if (opening > 0 || input.batchNo || input.expiryDate) {
      const batch = db
        .prepare('INSERT INTO inventory_batches (item_id, batch_no, expiry_date, quantity, unit_cost_paisa, purchase_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, input.batchNo?.trim() ?? '', input.expiryDate ?? null, opening, input.purchaseCostPaisa ?? 0, todayLocal(), at);
      db.prepare('INSERT INTO inventory_transactions (item_id, batch_id, txn_type, quantity, unit_cost_paisa, reason, performed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id,
        batch.lastInsertRowid,
        'in',
        opening,
        input.purchaseCostPaisa ?? 0,
        'Opening stock',
        me.userId,
        at,
      );
    }
    audit({ action: 'inventory.created', entity: 'inventory_item', entityId: id });
  });
  return { id };
}

export function updateInventoryItem(id: number, input: Partial<Omit<InventoryItemInput, 'sku' | 'openingStock'>>): void {
  sessionManager.ensurePermission('inventory.manage');
  const db = getDb();
  const cur = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get<Record<string, string | number | null>>(id);
  if (!cur) throw new NotFoundError('Inventory item');
  if (input.expiryDate && !isValidDateOnly(input.expiryDate)) throw new ValidationError('Expiry date must be YYYY-MM-DD.');
  db.prepare(
    `UPDATE inventory_items SET name = ?, category = ?, supplier_id = ?, unit = ?, purchase_cost_paisa = ?, selling_cost_paisa = ?, min_stock = ?, expiry_date = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.name?.trim() ?? String(cur.name),
    input.category ?? String(cur.category),
    input.supplierId !== undefined ? input.supplierId : cur.supplier_id,
    input.unit ?? String(cur.unit),
    input.purchaseCostPaisa ?? Number(cur.purchase_cost_paisa),
    input.sellingCostPaisa ?? Number(cur.selling_cost_paisa),
    input.minStock ?? Number(cur.min_stock),
    input.expiryDate !== undefined ? input.expiryDate : cur.expiry_date,
    input.notes ?? String(cur.notes),
    nowIso(),
    id,
  );
  audit({ action: 'inventory.updated', entity: 'inventory_item', entityId: id });
}

export function retireInventoryItem(id: number): void {
  sessionManager.ensurePermission('inventory.manage');
  const res = getDb().prepare('UPDATE inventory_items SET is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), id);
  if (!res.changes) throw new NotFoundError('Inventory item');
  audit({ action: 'inventory.retired', entity: 'inventory_item', entityId: id });
}

export interface StockMovementInput {
  itemId: number;
  type: 'in' | 'out' | 'adjust';
  quantity: number; // adjust: signed delta
  batchNo?: string;
  expiryDate?: string | null;
  unitCostPaisa?: number;
  reason?: string;
  reference?: string;
}

export function stockMovement(input: StockMovementInput): void {
  sessionManager.ensurePermission('inventory.manage');
  const db = getDb();
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ? AND is_active = 1').get<Record<string, string | number>>(input.itemId);
  if (!item) throw new NotFoundError('Inventory item');
  if (!Number.isFinite(input.quantity) || input.quantity === 0) throw new ValidationError('Quantity must be a non-zero number.');
  if (input.type !== 'adjust' && input.quantity <= 0) throw new ValidationError('Stock in/out quantity must be positive.');
  if (input.expiryDate && !isValidDateOnly(input.expiryDate)) throw new ValidationError('Expiry date must be YYYY-MM-DD.');

  const current = Number(item.current_stock);
  let newStock: number;
  if (input.type === 'in') newStock = current + input.quantity;
  else if (input.type === 'out') newStock = current - input.quantity;
  else newStock = current + input.quantity;
  if (newStock < 0) throw new ValidationError(`Cannot reduce stock below zero (current: ${current}).`);

  const me = sessionManager.currentUser();
  const at = nowIso();
  tx(() => {
    let batchId: number | null = null;
    if (input.type === 'in') {
      const b = db
        .prepare('INSERT INTO inventory_batches (item_id, batch_no, expiry_date, quantity, unit_cost_paisa, purchase_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(input.itemId, input.batchNo?.trim() ?? '', input.expiryDate ?? null, input.quantity, input.unitCostPaisa ?? Number(item.purchase_cost_paisa), todayLocal(), at);
      batchId = b.lastInsertRowid;
      // keep item-level nearest expiry accurate
      const nearest = db
        .prepare("SELECT MIN(expiry_date) AS m FROM inventory_batches WHERE item_id = ? AND expiry_date IS NOT NULL AND expiry_date != '' AND quantity > 0")
        .get<{ m: string | null }>(input.itemId)!.m;
      db.prepare('UPDATE inventory_items SET expiry_date = ? WHERE id = ?').run(nearest, input.itemId);
    } else if (input.type === 'out') {
      // Consume from oldest non-expired batch (FIFO-ish, informational).
      let remaining = input.quantity;
      const batches = db
        .prepare(`SELECT id, quantity FROM inventory_batches WHERE item_id = ? AND quantity > 0 ORDER BY COALESCE(expiry_date, '9999-12-31') ASC, id ASC`)
        .all<{ id: number; quantity: number }>(input.itemId);
      const upd = db.prepare('UPDATE inventory_batches SET quantity = quantity - ? WHERE id = ?');
      for (const b of batches) {
        if (remaining <= 0) break;
        const take = Math.min(b.quantity, remaining);
        upd.run(take, b.id);
        remaining -= take;
      }
    }
    db.prepare('INSERT INTO inventory_transactions (item_id, batch_id, txn_type, quantity, unit_cost_paisa, reason, reference, performed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      input.itemId,
      batchId,
      input.type,
      input.type === 'adjust' ? input.quantity : input.type === 'out' ? -input.quantity : input.quantity,
      input.unitCostPaisa ?? 0,
      input.reason?.trim() ?? '',
      input.reference?.trim() ?? '',
      me.userId,
      at,
    );
    db.prepare('UPDATE inventory_items SET current_stock = ?, updated_at = ? WHERE id = ?').run(newStock, at, input.itemId);
    audit({ action: `inventory.${input.type}`, entity: 'inventory_item', entityId: input.itemId, details: { qty: input.quantity, newStock } });
  });
}

export function stockLedger(itemId: number) {
  sessionManager.ensurePermission('inventory.view');
  return getDb()
    .prepare(
      `SELECT t.*, u.display_name AS performed_by_name FROM inventory_transactions t LEFT JOIN users u ON u.id = t.performed_by
       WHERE t.item_id = ? ORDER BY t.created_at DESC LIMIT 500`,
    )
    .all(itemId);
}

export function inventoryAlerts() {
  sessionManager.ensurePermission('inventory.view');
  const db = getDb();
  const horizon = addDays(todayLocal(), getSettingInt('expiry_warning_days', 30));
  const low = db.prepare('SELECT id, name, sku, current_stock, min_stock FROM inventory_items WHERE is_active = 1 AND current_stock <= min_stock ORDER BY current_stock ASC').all();
  const out = db.prepare('SELECT id, name, sku FROM inventory_items WHERE is_active = 1 AND current_stock <= 0').all();
  const expiring = db.prepare("SELECT id, name, sku, expiry_date FROM inventory_items WHERE is_active = 1 AND expiry_date IS NOT NULL AND expiry_date != '' AND date(expiry_date) <= ? AND date(expiry_date) >= date('now') ORDER BY expiry_date ASC").all(horizon);
  const expired = db.prepare("SELECT id, name, sku, expiry_date FROM inventory_items WHERE is_active = 1 AND expiry_date IS NOT NULL AND expiry_date != '' AND date(expiry_date) < date('now') ORDER BY expiry_date ASC").all();
  return { low, out, expiring, expired };
}

// --- suppliers ---------------------------------------------------------------

export function listSuppliers() {
  sessionManager.ensurePermission('inventory.view');
  return getDb().prepare('SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name ASC').all();
}

export function upsertSupplier(input: { id?: number; name: string; contactPerson?: string; phone?: string; email?: string; address?: string; notes?: string }): { id: number } {
  sessionManager.ensurePermission('inventory.manage');
  if (!input.name?.trim()) throw new ValidationError('Supplier name is required.');
  const db = getDb();
  if (input.id) {
    db.prepare('UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?').run(
      input.name.trim(),
      input.contactPerson?.trim() ?? '',
      input.phone?.trim() ?? '',
      input.email?.trim() ?? '',
      input.address?.trim() ?? '',
      input.notes?.trim() ?? '',
      input.id,
    );
    audit({ action: 'supplier.updated', entity: 'supplier', entityId: input.id });
    return { id: input.id };
  }
  const res = db.prepare('INSERT INTO suppliers (name, contact_person, phone, email, address, notes, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run(
    input.name.trim(),
    input.contactPerson?.trim() ?? '',
    input.phone?.trim() ?? '',
    input.email?.trim() ?? '',
    input.address?.trim() ?? '',
    input.notes?.trim() ?? '',
    nowIso(),
  );
  audit({ action: 'supplier.created', entity: 'supplier', entityId: res.lastInsertRowid });
  return { id: res.lastInsertRowid };
}
