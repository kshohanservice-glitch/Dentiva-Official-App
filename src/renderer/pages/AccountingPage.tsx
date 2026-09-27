import { useCallback, useEffect, useState } from 'react';
import { api, type AccountingReport, type AccountingEntryRow, type Category, type PaymentMethod } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Pagination, Select, useToast } from '../components/ui';
import { IconChart, IconPlus, IconPrinter } from '../components/Icons';
import { formatBDT, parseAmountToPaisa } from '../../shared/money';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

type Kind = 'income' | 'expense';

export function AccountingPage(_p: { ctx: NavCtx }) {
  const [kind, setKind] = useState<Kind | 'report'>('income');
  const [rows, setRows] = useState<AccountingEntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const pageSize = 25;
  const { toast } = useToast();

  const loadCats = useCallback(async () => {
    if (kind === 'report') return;
    try {
      const c = await api.accountingCategories(kind);
      setCategories(c);
    } catch {
      /* categories load failure surfaces in the form */
    }
  }, [kind]);

  const load = useCallback(async () => {
    if (kind === 'report') return;
    setLoading(true);
    setError('');
    try {
      const res = await api.accountingList(kind, { page, pageSize });
      setRows(res.rows as unknown as AccountingEntryRow[]);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load entries.');
    } finally {
      setLoading(false);
    }
  }, [kind, page]);

  useEffect(() => {
    void load();
    void loadCats();
  }, [load, loadCats]);

  useEffect(() => {
    api.paymentMethods().then((m) => setMethods(m)).catch(() => undefined);
  }, []);

  if (kind === 'report') {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <div className="crumb">Billing</div>
            <h1>Accounting</h1>
            <div className="dp-sub" style={{ marginTop: 2 }}>Income and expenses beyond patient billing</div>
          </div>
        </div>
        <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
          <button className="tab" onClick={() => { setKind('income'); setPage(1); }} role="tab">Income</button>
          <button className="tab" onClick={() => { setKind('expense'); setPage(1); }} role="tab">Expenses</button>
          <button className="tab active" role="tab">Report</button>
        </div>
        <ReportPanel />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Billing</div>
          <h1>Accounting</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>Income and expenses beyond patient billing</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setAdding(true)}>
            Add {kind}
          </Button>
        </div>
      </div>

      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        <button className={`tab ${kind === 'income' ? 'active' : ''}`} onClick={() => { setKind('income'); setPage(1); }} role="tab">Income</button>
        <button className={`tab ${kind === 'expense' ? 'active' : ''}`} onClick={() => { setKind('expense'); setPage(1); }} role="tab">Expenses</button>
        <button className="tab" onClick={() => setKind('report')} role="tab">Report</button>
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={7} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconChart size={24} />}
            title={`No ${kind} entries`}
            desc={`Record ${kind} such as rent, salaries, equipment or other income that sits outside patient invoices.`}
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setAdding(true)}>Add {kind}</Button>}
          />
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>{kind === 'income' ? 'Payer' : 'Vendor'}</th>
                  <th>Description</th>
                  <th>Method</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.entry_date).toLocaleDateString('en-GB')}</td>
                    <td><Badge tone="info">{r.category_name}</Badge></td>
                    <td>{r.party || '—'}</td>
                    <td className="cell-sub">{r.description || '—'}</td>
                    <td className="cell-sub">{r.method_name ?? '—'}</td>
                    <td className="num" style={{ color: kind === 'income' ? 'var(--dp-success)' : 'var(--dp-error)', fontWeight: 700 }}>
                      {kind === 'income' ? '+' : '−'} {formatBDT(r.amount_paisa)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}

      {adding && (
        <EntryDialog
          kind={kind}
          categories={categories}
          methods={methods}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            toast('success', `${kind === 'income' ? 'Income' : 'Expense'} recorded`);
            void load();
          }}
        />
      )}
    </div>
  );
}

function EntryDialog({ kind, categories, methods, onClose, onSaved }: { kind: Kind; categories: Category[]; methods: PaymentMethod[]; onClose: () => void; onSaved: () => void }) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ? String(categories[0].id) : '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [methodId, setMethodId] = useState('');
  const [party, setParty] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const paisa = parseAmountToPaisa(amount);
      if (paisa === null || paisa <= 0) throw new Error('Enter a valid positive amount.');
      if (!categoryId) throw new Error('Choose a category.');
      const payload = {
        categoryId: Number(categoryId),
        amountPaisa: paisa,
        entryDate: date,
        methodId: methodId ? Number(methodId) : null,
        description: description.trim() || undefined,
        party: party.trim() || undefined,
      };
      if (kind === 'income') await api.accountingAddIncome(payload);
      else await api.accountingAddExpense(payload);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save entry.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Add ${kind}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Save entry</Button>
        </>
      }
    >
      {categories.length === 0 ? (
        <div className="alert alert-warning" style={{ marginBottom: 12 }}>
          No {kind} categories exist yet. Ask an administrator to add one in Settings → Accounting categories.
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Category" required>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (৳)" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus /></Field>
        <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Method">
          <Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            <option value="">— none —</option>
            {methods.filter((m) => m.is_active).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={kind === 'income' ? 'Payer' : 'Vendor'}><Input value={party} onChange={(e) => setParty(e.target.value)} /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

function ReportPanel() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [report, setReport] = useState<AccountingReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const { toast } = useToast();

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await api.accountingReport({ from, to }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to build report.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <>
      <div className="toolbar">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button variant="secondary" onClick={() => void run()} style={{ alignSelf: 'flex-end' }}>Refresh</Button>
        <Button
          variant="secondary"
          icon={<IconPrinter size={14} />}
          loading={printing}
          style={{ alignSelf: 'flex-end' }}
          onClick={async () => {
            setPrinting(true);
            try {
              await api.printReport(from, to);
              toast('success', 'Report sent to printer');
            } catch (e) {
              toast('error', 'Print failed', e instanceof Error ? e.message : undefined);
            } finally {
              setPrinting(false);
            }
          }}
        >
          Print report
        </Button>
        <Button
          variant="secondary"
          loading={savingPdf}
          style={{ alignSelf: 'flex-end' }}
          onClick={async () => {
            setSavingPdf(true);
            try {
              const saved = await api.pdfReport(from, to, `accounting-report-${from}-${to}.pdf`);
              if (saved) toast('success', 'PDF saved', saved);
            } catch (e) {
              toast('error', 'PDF export failed', e instanceof Error ? e.message : undefined);
            } finally {
              setSavingPdf(false);
            }
          }}
        >
          Save PDF
        </Button>
      </div>

      {error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void run()} /></div>
      ) : loading || !report ? (
        <div className="card"><LoadingRows rows={6} /></div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, margin: '16px 0' }}>
            <Stat label="Total income" value={formatBDT(report.totalIncomePaisa)} tone="var(--dp-success)" />
            <Stat label="Total expenses" value={formatBDT(report.totalExpensePaisa)} tone="var(--dp-error)" />
            <Stat label="Net income" value={formatBDT(report.netIncomePaisa)} tone={report.netIncomePaisa >= 0 ? 'var(--dp-success)' : 'var(--dp-error)'} />
            <Stat label="Invoiced" value={formatBDT(report.invoicedPaisa)} />
            <Stat label="Receivables due" value={formatBDT(report.outstandingPaisa)} tone={report.outstandingPaisa > 0 ? 'var(--dp-error)' : undefined} />
            <Stat label="Treatment value" value={formatBDT(report.treatmentValuePaisa)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card card-pad">
              <span className="card-title">Payments collected by method</span>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <KV k="Cash" v={formatBDT(report.byMethod.cash)} />
                <KV k="Bank" v={formatBDT(report.byMethod.bank)} />
                <KV k="Card" v={formatBDT(report.byMethod.card)} />
                <KV k="Mobile wallet" v={formatBDT(report.byMethod.mobileWallet)} />
                <KV k="Other" v={formatBDT(report.byMethod.other)} />
              </div>
            </div>
            <div className="card card-pad">
              <span className="card-title">Income breakdown</span>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <KV k="From payments (treatments)" v={formatBDT(report.treatmentIncomePaisa)} />
                <KV k="Other income entries" v={formatBDT(report.otherIncomePaisa)} />
                {report.incomeByCategory.map((c) => (
                  <KV key={c.category} k={c.category} v={formatBDT(c.total)} />
                ))}
              </div>
            </div>
            <div className="card card-pad" style={{ gridColumn: '1 / -1' }}>
              <span className="card-title">Expenses by category</span>
              {report.expenseByCategory.length === 0 ? (
                <div className="dp-sub" style={{ marginTop: 10 }}>No expenses recorded in this range.</div>
              ) : (
                <div className="table-wrap" style={{ marginTop: 10, border: 'none' }}>
                  <table className="table">
                    <thead><tr><th>Category</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      {report.expenseByCategory.map((c) => (
                        <tr key={c.category}>
                          <td>{c.category}</td>
                          <td className="num" style={{ color: 'var(--dp-error)', fontWeight: 600 }}>{formatBDT(c.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ background: 'var(--dp-surface-2)', border: '1px solid var(--dp-divider)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--dp-text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, color: tone ?? 'var(--dp-text)' }}>{value}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span className="dp-sub">{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
}
