import { useCallback, useEffect, useState } from 'react';
import { api, type InvoiceRow, type PatientRow, type PaymentMethod, type TreatmentRow } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Pagination, SearchInput, Select, Textarea, useToast } from '../components/ui';
import { PatientPicker } from '../components/PatientPicker';
import { IconInvoice, IconPlus, IconTrash, IconEye, IconPrinter } from '../components/Icons';
import { formatBDT, parseAmountToPaisa } from '../../shared/money';

const STATUS: Record<string, { tone: 'success' | 'warning' | 'error' | 'info' | 'neutral'; label: string }> = {
  unpaid: { tone: 'error', label: 'Unpaid' },
  partial: { tone: 'warning', label: 'Partially paid' },
  paid: { tone: 'success', label: 'Paid' },
  void: { tone: 'neutral', label: 'Void' },
};

interface DraftLine {
  treatmentId: number | null;
  description: string;
  quantity: number;
  unitPricePaisa: number;
}

export function InvoicesPage({ ctx }: { ctx: NavCtx }) {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const pageSize = 25;
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.invoiceList({ search: search || undefined, status, page, pageSize });
      setRows(res.rows as unknown as InvoiceRow[]);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoices.');
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Billing</div>
          <h1>Invoices</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>{total} invoices · newest first</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>New invoice</Button>
        </div>
      </div>

      <div className="toolbar">
        <SearchInput placeholder="Search invoice no, patient name or code…" onSearch={(v) => { setSearch(v); setPage(1); }} />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 160 }} aria-label="Status filter">
          <option value="all">All statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partially paid</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </Select>
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={8} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconInvoice size={24} />}
            title="No invoices match"
            desc="Create an invoice from treatments recorded for a patient, or bill ad-hoc line items."
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setCreating(true)}>New invoice</Button>}
          />
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Patient</th>
                  <th className="num">Total</th>
                  <th className="num">Paid</th>
                  <th className="num">Due</th>
                  <th>Status</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const badge = STATUS[inv.status] ?? { tone: 'neutral' as const, label: inv.status };
                  const due = inv.grand_total_paisa - inv.paid_paisa;
                  return (
                    <tr key={inv.id} className="clickable" onClick={() => setViewing(inv.id)}>
                      <td className="dp-mono cell-main">{inv.invoice_no}</td>
                      <td>{new Date(inv.invoice_date).toLocaleDateString('en-GB')}</td>
                      <td>
                        <button className="link" onClick={(e) => { e.stopPropagation(); ctx.navigate(`patient:${inv.patient_id}`); }}>{inv.patient_name}</button>
                        <span className="dp-sub" style={{ marginLeft: 8 }}>{inv.patient_code}</span>
                      </td>
                      <td className="num">{formatBDT(inv.grand_total_paisa)}</td>
                      <td className="num">{formatBDT(inv.paid_paisa)}</td>
                      <td className="num" style={{ color: due > 0 ? 'var(--dp-error)' : 'var(--dp-success)' }}>{formatBDT(due)}</td>
                      <td><Badge tone={badge.tone}>{badge.label}</Badge></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" icon={<IconEye size={14} />} onClick={() => setViewing(inv.id)} aria-label="View invoice" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}

      {creating && (
        <InvoiceEditor
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            toast('success', 'Invoice created');
            void load();
            setViewing(id);
          }}
        />
      )}

      {viewing !== null && (
        <InvoiceDetail
          id={viewing}
          onClose={() => setViewing(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function InvoiceEditor({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [picking, setPicking] = useState(false);
  const [catalog, setCatalog] = useState<TreatmentRow[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([{ treatmentId: null, description: '', quantity: 1, unitPricePaisa: 0 }]);
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.treatmentsList(false, '').then((t) => setCatalog(t as unknown as TreatmentRow[])).catch(() => undefined);
  }, []);

  const lineTotal = (l: DraftLine) => l.unitPricePaisa * l.quantity;
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const discountPaisa = discount.trim() ? parseAmountToPaisa(discount) ?? 0 : 0;
  const grand = subtotal - discountPaisa;

  const setLine = (i: number, patch: Partial<DraftLine>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const pickTreatment = (i: number, treatmentId: number | null) => {
    if (!treatmentId) {
      setLine(i, { treatmentId: null });
      return;
    }
    const t = catalog.find((c) => c.id === treatmentId);
    if (t) setLine(i, { treatmentId: t.id, description: t.name, unitPricePaisa: t.default_price_paisa });
  };

  const submit = async () => {
    setError('');
    if (!patient) {
      setError('Choose the patient to bill.');
      return;
    }
    if (lines.some((l) => !l.description.trim())) {
      setError('Every line needs a description.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.invoiceCreate({
        patientId: patient.id,
        items: lines.map((l) => ({
          treatmentId: l.treatmentId,
          description: l.description.trim(),
          quantity: l.quantity,
          unitPricePaisa: l.unitPricePaisa,
        })),
        discountPaisa,
        notes: notes.trim() || undefined,
      });
      onSaved(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create invoice.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New invoice"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <div className="dp-sub" style={{ marginRight: 'auto' }}>
            Subtotal {formatBDT(subtotal)} − discount {formatBDT(discountPaisa)} = <strong style={{ color: 'var(--dp-text)' }}>Total {formatBDT(grand)}</strong>
          </div>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Create invoice</Button>
        </>
      }
    >
      <Field label="Patient" required>
        {patient ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Input value={`${patient.full_name} (${patient.patient_code})`} readOnly />
            <Button variant="secondary" onClick={() => setPicking(true)}>Change</Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setPicking(true)}>Select patient…</Button>
        )}
      </Field>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 90px 120px 90px 36px', gap: 8, padding: '0 4px 6px', fontSize: 11, fontWeight: 700, color: 'var(--dp-text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <span>Treatment (optional)</span>
          <span>Description</span>
          <span>Qty</span>
          <span>Unit price (৳)</span>
          <span className="num" style={{ textAlign: 'right' }}>Line</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 90px 120px 90px 36px', gap: 8, marginBottom: 8 }}>
            <Select value={l.treatmentId ?? ''} onChange={(e) => pickTreatment(i, e.target.value ? Number(e.target.value) : null)}>
              <option value="">— custom line —</option>
              {catalog.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({formatBDT(t.default_price_paisa)})</option>
              ))}
            </Select>
            <Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Line description" />
            <Input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
            <Input
              inputMode="decimal"
              value={(l.unitPricePaisa / 100).toFixed(2)}
              onChange={(e) => setLine(i, { unitPricePaisa: parseAmountToPaisa(e.target.value) ?? 0 })}
            />
            <span className="num" style={{ alignSelf: 'center', textAlign: 'right', fontWeight: 600 }}>{formatBDT(lineTotal(l))}</span>
            <Button size="sm" variant="ghost" icon={<IconTrash size={14} />} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove line" />
          </div>
        ))}
        <Button variant="secondary" size="sm" icon={<IconPlus size={14} />} onClick={() => setLines((ls) => [...ls, { treatmentId: null, description: '', quantity: 1, unitPricePaisa: 0 }])}>
          Add line
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
        <Field label="Discount (৳)" hint="Subtracted from the subtotal">
          <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional invoice notes" />
        </Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

      {picking && (
        <PatientPicker
          title="Choose patient to bill"
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPatient(p);
            setPicking(false);
          }}
        />
      )}
    </Modal>
  );
}

interface InvoiceFullLocal {
  id: number;
  invoice_no: string;
  invoice_date: string;
  status: string;
  subtotal_paisa: number;
  discount_paisa: number;
  tax_paisa: number;
  grand_total_paisa: number;
  paid_paisa: number;
  notes: string;
  patient_name: string;
  patient_code: string;
  phone: string;
  items: Array<{ id: number; description: string; quantity: number; unit_price_paisa: number; line_total_paisa: number; discount_paisa: number }>;
  payments: Array<{ id: number; receipt_no: string; amount_paisa: number; method_name: string; paid_at: string }>;
}

function InvoiceDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [inv, setInv] = useState<InvoiceFullLocal | null>(null);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const { toast } = useToast();

  const printInv = async () => {
    setPrinting(true);
    try {
      await api.printInvoice(id);
      toast('success', 'Invoice sent to printer');
    } catch (e) {
      toast('error', 'Print failed', e instanceof Error ? e.message : undefined);
    } finally {
      setPrinting(false);
    }
  };

  const pdfInv = async () => {
    setSavingPdf(true);
    try {
      const saved = await api.pdfInvoice(id, `invoice-${inv?.invoice_no ?? id}.pdf`);
      if (saved) toast('success', 'PDF saved', saved);
    } catch (e) {
      toast('error', 'PDF export failed', e instanceof Error ? e.message : undefined);
    } finally {
      setSavingPdf(false);
    }
  };

  const load = useCallback(async () => {
    try {
      setInv((await api.invoiceGet(id)) as unknown as InvoiceFullLocal);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoice.');
    }
  }, [id]);

  useEffect(() => {
    void load();
    api.paymentMethods().then((m) => setMethods(m)).catch(() => undefined);
  }, [load]);

  const outstanding = inv ? inv.grand_total_paisa - inv.paid_paisa : 0;

  return (
    <Modal
      title={inv ? `Invoice ${inv.invoice_no}` : 'Invoice'}
      size="lg"
      onClose={onClose}
      footer={
        inv ? (
          <>
            <div className="dp-sub" style={{ marginRight: 'auto' }}>
              Outstanding: <strong style={{ color: outstanding > 0 ? 'var(--dp-error)' : 'var(--dp-success)' }}>{formatBDT(outstanding)}</strong>
            </div>
            <Button variant="secondary" icon={<IconPrinter size={14} />} loading={printing} onClick={() => void printInv()}>Print</Button>
            <Button variant="secondary" loading={savingPdf} onClick={() => void pdfInv()}>PDF</Button>
            {inv.status !== 'void' && <Button variant="danger-outline" onClick={() => setVoidOpen(true)} disabled={inv.paid_paisa > 0}>Void</Button>}
            {inv.status !== 'void' && outstanding > 0 && <Button variant="primary" onClick={() => setPayOpen(true)}>Record payment</Button>}
          </>
        ) : undefined
      }
    >
      {!inv ? (
        error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingRows rows={6} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <div className="dp-sub">Patient</div>
              <div style={{ fontWeight: 600 }}>{inv.patient_name} <span className="dp-sub">({inv.patient_code})</span></div>
            </div>
            <div>
              <div className="dp-sub">Date</div>
              <div style={{ fontWeight: 600 }}>{new Date(inv.invoice_date).toLocaleDateString('en-GB')}</div>
            </div>
            <div>
              <div className="dp-sub">Status</div>
              <Badge tone={STATUS[inv.status]?.tone ?? 'neutral'}>{STATUS[inv.status]?.label ?? inv.status}</Badge>
            </div>
          </div>

          <div className="table-wrap" style={{ marginBottom: 14 }}>
            <table className="table">
              <thead>
                <tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Line total</th></tr>
              </thead>
              <tbody>
                {inv.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.description}</td>
                    <td className="num">{it.quantity}</td>
                    <td className="num">{formatBDT(it.unit_price_paisa)}</td>
                    <td className="num">{formatBDT(it.line_total_paisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ minWidth: 260, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Row l="Subtotal" v={formatBDT(inv.subtotal_paisa)} />
              {inv.discount_paisa > 0 && <Row l="Discount" v={`− ${formatBDT(inv.discount_paisa)}`} />}
              {inv.tax_paisa > 0 && <Row l="Tax" v={formatBDT(inv.tax_paisa)} />}
              <Row l="Grand total" v={formatBDT(inv.grand_total_paisa)} strong />
              <Row l="Paid" v={formatBDT(inv.paid_paisa)} />
              <Row l="Outstanding" v={formatBDT(outstanding)} strong tone={outstanding > 0 ? 'var(--dp-error)' : 'var(--dp-success)'} />
            </div>
          </div>

          {inv.payments.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <span className="card-title">Payments</span>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead><tr><th>Receipt</th><th>Method</th><th className="num">Amount</th><th>Date</th><th style={{ width: 70 }}></th></tr></thead>
                  <tbody>
                    {inv.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="dp-mono">{p.receipt_no}</td>
                        <td>{p.method_name}</td>
                        <td className="num" style={{ color: 'var(--dp-success)', fontWeight: 600 }}>{formatBDT(p.amount_paisa)}</td>
                        <td>{new Date(p.paid_at).toLocaleString('en-GB')}</td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<IconPrinter size={14} />}
                            title="Print receipt"
                            aria-label={`Print receipt ${p.receipt_no}`}
                            onClick={async () => {
                              try {
                                await api.printReceipt(p.id);
                                toast('success', 'Receipt sent to printer');
                              } catch (e) {
                                toast('error', 'Print failed', e instanceof Error ? e.message : undefined);
                              }
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {inv && payOpen && (
        <PaymentDialog
          invoice={inv}
          outstanding={outstanding}
          methods={methods}
          onClose={() => setPayOpen(false)}
          onDone={(receiptNo, status) => {
            setPayOpen(false);
            toast('success', `Payment ${receiptNo} recorded`, status === 'paid' ? 'Invoice fully settled.' : 'Invoice partially paid.');
            void load();
            onChanged();
          }}
        />
      )}

      {inv && voidOpen && (
        <VoidDialog
          invoice={inv}
          onClose={() => setVoidOpen(false)}
          onDone={() => {
            setVoidOpen(false);
            toast('success', 'Invoice voided');
            void load();
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

function Row({ l, v, strong, tone }: { l: string; v: string; strong?: boolean; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: strong ? 14 : 13, fontWeight: strong ? 700 : 400, color: tone ?? 'inherit' }}>
      <span>{l}</span>
      <span>{v}</span>
    </div>
  );
}

function PaymentDialog({ invoice, outstanding, methods, onClose, onDone }: { invoice: InvoiceFullLocal; outstanding: number; methods: PaymentMethod[]; onClose: () => void; onDone: (receiptNo: string, status: string) => void }) {
  const [amount, setAmount] = useState((outstanding / 100).toFixed(2));
  const [methodId, setMethodId] = useState(methods.find((m) => m.is_active)?.id ?? methods[0]?.id ?? 0);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const paisa = parseAmountToPaisa(amount);
      if (paisa === null || paisa <= 0) throw new Error('Enter a valid positive amount.');
      const res = await api.paymentRecord({ invoiceId: invoice.id, amountPaisa: paisa, methodId: Number(methodId), reference: reference.trim() || undefined });
      onDone(res.receiptNo, res.invoiceStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Record payment — ${invoice.invoice_no}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Record payment</Button>
        </>
      }
    >
      <div className="alert alert-info" style={{ marginBottom: 12 }}>
        Outstanding balance: <strong>{formatBDT(outstanding)}</strong>. Overpayment is rejected by the ledger.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Amount (৳)" required>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Method" required>
          <Select value={String(methodId)} onChange={(e) => setMethodId(Number(e.target.value))}>
            {methods.filter((m) => m.is_active).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reference (optional)" className="field-full">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. bKash transaction id" />
        </Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

function VoidDialog({ invoice, onClose, onDone }: { invoice: InvoiceFullLocal; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal
      title="Void invoice"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Keep invoice</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!reason.trim()}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await api.invoiceVoid(invoice.id, reason.trim());
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not void invoice.');
                setBusy(false);
              }
            }}
          >
            Void invoice
          </Button>
        </>
      }
    >
      <div className="alert alert-error" style={{ marginBottom: 12 }}>
        Voiding removes <strong>{invoice.invoice_no}</strong> from receivables permanently. It stays in records for audit with the reason below.
      </div>
      <Field label="Reason" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this invoice being voided?" autoFocus />
      </Field>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}
