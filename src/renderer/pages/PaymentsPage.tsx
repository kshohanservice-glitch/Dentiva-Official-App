import { useCallback, useEffect, useState } from 'react';
import { api, type InvoiceRow, type PaymentMethod, type PaymentsPage } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Pagination, SearchInput, Select, useToast } from '../components/ui';
import { IconPayments, IconPlus } from '../components/Icons';
import { formatBDT, parseAmountToPaisa } from '../../shared/money';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
] as const;

export function PaymentsPage({ ctx }: { ctx: NavCtx }) {
  const [data, setData] = useState<PaymentsPage | null>(null);
  const [preset, setPreset] = useState<string>('today');
  const [methodId, setMethodId] = useState('all');
  const [page, setPage] = useState(1);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const pageSize = 25;
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.paymentsList({ preset, methodId: methodId === 'all' ? undefined : Number(methodId), page, pageSize });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payments.');
    } finally {
      setLoading(false);
    }
  }, [preset, methodId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.paymentMethods().then((m) => setMethods(m)).catch(() => undefined);
  }, []);

  const sums = data?.sums;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Billing</div>
          <h1>Payments</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>{data ? `${data.total} payments in view` : 'Loading…'}</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setRecording(true)}>Record payment</Button>
        </div>
      </div>

      {sums && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          <SumCard label="Collected" value={formatBDT(sums.total ?? 0)} />
          <SumCard label="Cash" value={formatBDT(sums.cash ?? 0)} />
          <SumCard label="Bank" value={formatBDT(sums.bank ?? 0)} />
          <SumCard label="Card" value={formatBDT(sums.card ?? 0)} />
          <SumCard label="Mobile wallet" value={formatBDT(sums.mobile_wallet ?? 0)} />
          <SumCard label="Receivables due" value={formatBDT(data?.outstandingPaisa ?? 0)} danger={(data?.outstandingPaisa ?? 0) > 0} />
        </div>
      )}

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Date preset">
          {PRESETS.map((p) => (
            <button key={p.id} className={preset === p.id ? 'active' : ''} onClick={() => { setPreset(p.id); setPage(1); }}>{p.label}</button>
          ))}
        </div>
        <Select value={methodId} onChange={(e) => { setMethodId(e.target.value); setPage(1); }} style={{ width: 180 }} aria-label="Payment method">
          <option value="all">All methods</option>
          {methods.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={8} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : !data || data.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconPayments size={24} />}
            title="No payments in this period"
            desc="Record a payment against an open invoice, or widen the date filter."
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setRecording(true)}>Record payment</Button>}
          />
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th>Patient</th>
                  <th>Invoice</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id}>
                    <td className="dp-mono cell-main">{p.receipt_no}</td>
                    <td>{new Date(p.paid_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td><button className="link" onClick={() => ctx.navigate(`patient:${p.patient_id}`)}>{p.patient_name}</button></td>
                    <td className="dp-mono">{p.invoice_no}</td>
                    <td>{p.method_name}</td>
                    <td className="cell-sub">{p.reference || '—'}</td>
                    <td className="num" style={{ color: 'var(--dp-success)', fontWeight: 600 }}>{formatBDT(p.amount_paisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />
        </>
      )}

      {recording && (
        <RecordPaymentDialog
          methods={methods}
          onClose={() => setRecording(false)}
          onDone={(receiptNo) => {
            setRecording(false);
            toast('success', `Payment ${receiptNo} recorded`);
            void load();
          }}
        />
      )}
    </div>
  );
}

function SumCard({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ background: 'var(--dp-surface-2)', border: '1px solid var(--dp-divider)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--dp-text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, color: danger ? 'var(--dp-error)' : 'var(--dp-text)' }}>{value}</div>
    </div>
  );
}

/** Pick an open invoice, then record a payment against it. */
function RecordPaymentDialog({ methods, onClose, onDone }: { methods: PaymentMethod[]; onClose: () => void; onDone: (receiptNo: string) => void }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<InvoiceRow | null>(null);
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState(methods.find((m) => m.is_active)?.id ?? 0);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadingInv, setLoadingInv] = useState(true);

  useEffect(() => {
    let live = true;
    setLoadingInv(true);
    api
      .invoiceList({ status: 'all', search: search || undefined, page: 1, pageSize: 100 })
      .then((res) => {
        if (!live) return;
        setInvoices((res.rows as unknown as InvoiceRow[]).filter((r) => r.status === 'unpaid' || r.status === 'partial'));
      })
      .catch(() => undefined)
      .finally(() => live && setLoadingInv(false));
    return () => {
      live = false;
    };
  }, [search]);

  const outstanding = picked ? picked.grand_total_paisa - picked.paid_paisa : 0;

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setError('');
    try {
      const paisa = parseAmountToPaisa(amount);
      if (paisa === null || paisa <= 0) throw new Error('Enter a valid positive amount.');
      const res = await api.paymentRecord({ invoiceId: picked.id, amountPaisa: paisa, methodId: Number(methodId), reference: reference.trim() || undefined });
      onDone(res.receiptNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment.');
      setBusy(false);
    }
  };

  if (picked) {
    return (
      <Modal
        title={`Record payment — ${picked.invoice_no}`}
        onClose={onClose}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPicked(null)}>Pick another invoice</Button>
            <Button variant="primary" loading={busy} onClick={() => void submit()}>Record payment</Button>
          </>
        }
      >
        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          <strong>{picked.patient_name}</strong> owes <strong>{formatBDT(outstanding)}</strong> on invoice {picked.invoice_no}. Overpayment is rejected by the ledger.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Amount (৳)" required hint={`Outstanding ${formatBDT(outstanding)}`}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
          </Field>
          <Field label="Method" required>
            <Select value={String(methodId)} onChange={(e) => setMethodId(Number(e.target.value))}>
              {methods.filter((m) => m.is_active).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reference (optional)" className="field-full">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. cheque or bKash transaction id" />
          </Field>
        </div>
        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
      </Modal>
    );
  }

  return (
    <Modal title="Record payment — choose invoice" onClose={onClose} size="lg">
      <SearchInput autoFocus placeholder="Search open invoices by number or patient…" onSearch={setSearch} />
      <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto' }}>
        {loadingInv ? (
          <LoadingRows rows={4} />
        ) : invoices.length === 0 ? (
          <EmptyState title="No open invoices" desc="Every invoice is settled or void. Create an invoice first, then record its payment here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {invoices.map((inv) => {
              const due = inv.grand_total_paisa - inv.paid_paisa;
              return (
                <button
                  key={inv.id}
                  onClick={() => {
                    setPicked(inv);
                    setAmount((due / 100).toFixed(2));
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--dp-surface-2)', border: '1px solid var(--dp-divider)', borderRadius: 10, cursor: 'pointer', textAlign: 'left', width: '100%' }}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="dp-mono" style={{ fontWeight: 600 }}>{inv.invoice_no}</span>
                    <span className="dp-sub" style={{ marginLeft: 10 }}>{inv.patient_name}</span>
                    <span className="dp-sub" style={{ marginLeft: 10 }}>{new Date(inv.invoice_date).toLocaleDateString('en-GB')}</span>
                  </span>
                  <span style={{ color: 'var(--dp-error)', fontWeight: 700 }}>{formatBDT(due)} due</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
