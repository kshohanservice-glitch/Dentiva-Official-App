import { useCallback, useEffect, useState } from 'react';
import { api, type InventoryRow, type InventoryLedgerRow, type SupplierRow } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, SearchInput, Select, useToast } from '../components/ui';
import { IconBox, IconPlus, IconClock } from '../components/Icons';
import { parseAmountToPaisa } from '../../shared/money';

interface Alerts {
  low: Array<{ id: number; name: string; sku: string; current_stock: number; min_stock: number }>;
  out: Array<{ id: number; name: string; sku: string }>;
  expiring: Array<{ id: number; name: string; sku: string; expiry_date: string }>;
  expired: Array<{ id: number; name: string; sku: string; expiry_date: string }>;
}

export function InventoryPage(_p: { ctx: NavCtx }) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; row: InventoryRow } | null>(null);
  const [moving, setMoving] = useState<InventoryRow | null>(null);
  const [ledger, setLedger] = useState<InventoryRow | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [items, al] = await Promise.all([
        api.inventoryList({ search: search || undefined, lowOnly, expiringOnly }),
        api.inventoryAlerts(),
      ]);
      setRows(items as unknown as InventoryRow[]);
      setAlerts(al as unknown as Alerts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inventory.');
    } finally {
      setLoading(false);
    }
  }, [search, lowOnly, expiringOnly]);

  useEffect(() => {
    void load();
    api.suppliersList().then((s) => setSuppliers(s as unknown as SupplierRow[])).catch(() => undefined);
  }, [load]);

  const alertCount = alerts ? alerts.low.length + alerts.out.length + alerts.expiring.length + alerts.expired.length : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Billing</div>
          <h1>Inventory</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>{rows.length} items · {alertCount} stock alerts</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setEditor({ mode: 'create' })}>New item</Button>
        </div>
      </div>

      {alerts && alertCount > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {alerts.out.length > 0 && (
            <span><strong>Out of stock:</strong> {alerts.out.map((o) => o.name).join(', ')}</span>
          )}
          {alerts.low.length > 0 && (
            <span><strong>Low stock:</strong> {alerts.low.map((o) => `${o.name} (${o.current_stock}/${o.min_stock})`).join(', ')}</span>
          )}
          {alerts.expired.length > 0 && (
            <span><strong>Expired:</strong> {alerts.expired.map((o) => `${o.name} (${o.expiry_date})`).join(', ')}</span>
          )}
          {alerts.expiring.length > 0 && (
            <span><strong>Expiring soon:</strong> {alerts.expiring.map((o) => `${o.name} (${o.expiry_date})`).join(', ')}</span>
          )}
        </div>
      )}

      <div className="toolbar">
        <SearchInput placeholder="Search by name, SKU or category…" onSearch={setSearch} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          <span>Low stock only</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={expiringOnly} onChange={(e) => setExpiringOnly(e.target.checked)} />
          <span>Expiring only</span>
        </label>
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={8} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconBox size={24} />}
            title="No inventory items"
            desc="Add materials and consumables to track stock, batch expiry and reorder levels."
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setEditor({ mode: 'create' })}>New item</Button>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th className="num">Stock</th>
                <th className="num">Min</th>
                <th>Expiry</th>
                <th>Supplier</th>
                <th style={{ width: 190 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const low = it.current_stock <= it.min_stock;
                return (
                  <tr key={it.id}>
                    <td className="dp-mono cell-main">{it.sku}</td>
                    <td>{it.name}</td>
                    <td className="cell-sub">{it.category || '—'}</td>
                    <td className="num" style={{ color: low ? 'var(--dp-error)' : 'inherit', fontWeight: low ? 700 : 400 }}>
                      {it.current_stock} {it.unit}
                    </td>
                    <td className="num">{it.min_stock}</td>
                    <td>{it.expiry_date || '—'}</td>
                    <td className="cell-sub">{it.supplier_name ?? '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="secondary" onClick={() => setMoving(it)}>Stock</Button>
                        <Button size="sm" variant="ghost" onClick={() => setLedger(it)}>Ledger</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditor({ mode: 'edit', row: it })}>Edit</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <ItemEditor
          existing={editor.mode === 'edit' ? editor.row : null}
          suppliers={suppliers}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            toast('success', editor.mode === 'create' ? 'Item created' : 'Item updated');
            void load();
          }}
        />
      )}

      {moving && (
        <StockMoveDialog
          item={moving}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            toast('success', 'Stock updated');
            void load();
          }}
        />
      )}

      {ledger && <LedgerDialog item={ledger} onClose={() => setLedger(null)} />}
    </div>
  );
}

function ItemEditor({ existing, suppliers, onClose, onSaved }: { existing: InventoryRow | null; suppliers: SupplierRow[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [sku, setSku] = useState(existing?.sku ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [unit, setUnit] = useState(existing?.unit ?? 'pcs');
  const [supplierId, setSupplierId] = useState(existing?.supplier_id ? String(existing.supplier_id) : '');
  const [minStock, setMinStock] = useState(existing ? String(existing.min_stock) : '5');
  const [openingStock, setOpeningStock] = useState('0');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [expiryDate, setExpiryDate] = useState(existing?.expiry_date ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isEdit = Boolean(existing);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        sku: sku.trim(),
        category: category.trim() || undefined,
        unit: unit.trim() || 'pcs',
        supplierId: supplierId ? Number(supplierId) : null,
        minStock: Number(minStock) || 0,
        purchaseCostPaisa: purchaseCost ? parseAmountToPaisa(purchaseCost) ?? undefined : undefined,
        openingStock: isEdit ? undefined : Number(openingStock) || 0,
        expiryDate: expiryDate || null,
      };
      if (isEdit && existing) {
        await api.inventoryUpdate(existing.id, payload);
      } else {
        await api.inventoryCreate(payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Edit — ${existing?.name}` : 'New inventory item'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>{isEdit ? 'Save changes' : 'Create item'}</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="SKU" required><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. GLV-NIT-M" /></Field>
        <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
        <Field label="Unit"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs, box, pack" /></Field>
        <Field label="Supplier">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— none —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Minimum stock" hint="Below this triggers a low-stock alert"><Input type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} /></Field>
        {!isEdit && (
          <Field label="Opening stock"><Input type="number" min={0} value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} /></Field>
        )}
        <Field label="Purchase cost (৳)"><Input inputMode="decimal" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Expiry date"><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

function StockMoveDialog({ item, onClose, onDone }: { item: InventoryRow; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<'in' | 'out' | 'adjust'>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty === 0) throw new Error('Enter a non-zero quantity.');
      await api.inventoryMove({ itemId: item.id, type, quantity: type === 'adjust' ? qty : Math.abs(qty), reason: reason.trim() || undefined });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record movement.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Stock movement — ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Record movement</Button>
        </>
      }
    >
      <div className="alert alert-info" style={{ marginBottom: 12 }}>
        Current stock: <strong>{item.current_stock} {item.unit}</strong>. Minimum: {item.min_stock} {item.unit}.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Movement" required>
          <Select value={type} onChange={(e) => setType(e.target.value as 'in' | 'out' | 'adjust')}>
            <option value="in">Stock in (purchase/receive)</option>
            <option value="out">Stock out (use/consume)</option>
            <option value="adjust">Adjust (signed)</option>
          </Select>
        </Field>
        <Field label="Quantity" required hint={type === 'adjust' ? 'Use negative to reduce' : 'Positive amount'}>
          <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
        </Field>
        <Field label="Reason / note" className="field-full">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. PO #123 received" />
        </Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

function LedgerDialog({ item, onClose }: { item: InventoryRow; onClose: () => void }) {
  const [rows, setRows] = useState<InventoryLedgerRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .inventoryLedger(item.id)
      .then((r) => setRows(r as unknown as InventoryLedgerRow[]))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load ledger.'));
  }, [item.id]);

  return (
    <Modal title={`Stock ledger — ${item.name}`} size="lg" onClose={onClose}>
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingRows rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<IconClock size={22} />} title="No movements yet" desc="Stock movements and adjustments will be logged here." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Type</th><th className="num">Qty</th><th>Reason</th><th>By</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>
                    <Badge tone={r.txn_type === 'in' ? 'success' : r.txn_type === 'out' ? 'warning' : 'info'}>{r.txn_type}</Badge>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{r.quantity > 0 ? `+${r.quantity}` : r.quantity}</td>
                  <td className="cell-sub">{r.reason || r.reference || '—'}</td>
                  <td className="cell-sub">{r.performed_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
