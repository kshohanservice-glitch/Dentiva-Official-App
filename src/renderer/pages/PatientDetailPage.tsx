import { useCallback, useEffect, useState } from 'react';
import { api, type PatientFull } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, useToast } from '../components/ui';
import { IconArrowLeft, IconEdit, IconPin, IconTrash, IconWallet } from '../components/Icons';
import { formatBDT } from '../../shared/money';
import { PatientEditor } from './PatientsPage';

export function PatientDetailPage({ ctx, id }: { ctx: NavCtx; id: number }) {
  const [p, setP] = useState<PatientFull | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | 'financial'>('overview');
  const [editing, setEditing] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      setP(await api.patientGet(id));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load patient.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !p) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (!p) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 120, borderRadius: 14 }} />
        <div className="skeleton" style={{ height: 300, borderRadius: 14, marginTop: 16 }} />
      </div>
    );
  }

  const s = p.summary;

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Button variant="ghost" size="sm" icon={<IconArrowLeft size={15} />} onClick={() => ctx.navigate('patients')}>
            Patients
          </Button>
        </div>
        <div className="page-actions">
          <Button variant="secondary" size="sm" icon={<IconPin size={14} />} onClick={() => void api.patientSetPinned(p.id, !p.is_pinned).then(load)}>
            {p.is_pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button variant="secondary" size="sm" icon={<IconEdit size={14} />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="danger-outline" size="sm" icon={<IconTrash size={14} />} onClick={() => setAskDelete(true)}>
            Delete
          </Button>
        </div>
      </div>

      {/* Hero */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="profile-hero">
          <div className="profile-avatar">{p.full_name.slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 className="dp-h1" style={{ fontSize: 20 }}>{p.full_name}</h1>
              <span className="dp-mono dp-sub">{p.patient_code}</span>
              {p.status === 'active' ? <Badge tone="success">Active</Badge> : p.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : <Badge tone="warning">Inactive</Badge>}
            </div>
            <div className="dp-sub" style={{ marginTop: 4 }}>
              {[
                p.age !== null ? `${p.age} yrs` : '',
                p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : '',
                p.blood_group ? `Blood: ${p.blood_group}` : '',
                p.phone || 'no phone',
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className="dp-sub">Registered {new Date(p.created_at).toLocaleString('en-GB')}</div>
          </div>
        </div>

        {/* Summary strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 18 }}>
          <SummaryStat label="Total visits" value={String(s.totalVisits)} />
          <SummaryStat label="Last visit" value={s.lastVisit ? new Date(s.lastVisit).toLocaleDateString('en-GB') : '—'} />
          <SummaryStat label="Next appointment" value={s.nextAppointment ? `${s.nextAppointment.date} ${s.nextAppointment.time}` : '—'} />
          <SummaryStat label="Total billed" value={formatBDT(s.totalBilledPaisa)} />
          <SummaryStat label="Total paid" value={formatBDT(s.totalPaidPaisa)} />
          <SummaryStat label="Outstanding" value={formatBDT(s.outstandingPaisa)} highlight={s.outstandingPaisa > 0} />
          <SummaryStat label="Prescriptions" value={String(s.prescriptions)} />
          <SummaryStat label="Treatments" value={String(s.treatments)} />
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')} role="tab">Overview</button>
        <button className={`tab ${tab === 'financial' ? 'active' : ''}`} onClick={() => setTab('financial')} role="tab">Financial history</button>
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <InfoCard title="Contact & address">
              <KV k="Phone" v={p.phone || '—'} />
              <KV k="Emergency phone" v={p.emergency_phone || '—'} />
              <KV k="Address" v={p.address || '—'} />
              <KV k="Other identifier" v={p.identifier || '—'} />
            </InfoCard>
            <InfoCard title="Clinical intake">
              <KV k="Present complaint" v={p.present_complaint || '—'} />
              <KV k="Past history" v={p.past_history || '—'} />
              <KV k="Notes" v={p.notes || '—'} />
            </InfoCard>
            <div className="card card-pad" style={{ gridColumn: '1 / -1' }}>
              <span className="card-title">Clinical record</span>
              <div className="dp-sub" style={{ marginTop: 8 }}>
                Visits, dental chart, prescriptions and the clinical timeline appear here — they are delivered with the Clinical
                module of this build and always reflect real records.
              </div>
            </div>
          </div>
        )}
        {tab === 'financial' && <FinancialHistory patientId={p.id} />}
      </div>

      {editing && (
        <PatientEditor
          existing={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
            toast('success', 'Patient updated');
          }}
        />
      )}

      {askDelete && (
        <ConfirmDialog
          title="Delete patient record"
          danger
          requireText={p.patient_code}
          confirmLabel="Delete patient"
          message={
            'This permanently removes the patient from active records. Patients with invoices or payments cannot be deleted to protect financial integrity — archive them instead.'
          }
          onConfirm={async () => {
            try {
              await api.patientDelete(p.id, p.patient_code);
              toast('success', 'Patient deleted');
              ctx.navigate('patients');
            } catch (e) {
              toast('error', 'Delete failed', e instanceof Error ? e.message : undefined);
              setAskDelete(false);
            }
          }}
          onClose={() => setAskDelete(false)}
        />
      )}
    </div>
  );
}

function SummaryStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ background: 'var(--dp-surface-2)', border: '1px solid var(--dp-divider)', borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--dp-text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, color: highlight ? 'var(--dp-error)' : 'var(--dp-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={value}>
        {value}
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <span className="card-title" style={{ marginBottom: 10 }}>{title}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span className="dp-sub" style={{ width: 140, flex: 'none' }}>{k}</span>
      <span style={{ fontSize: 13, overflowWrap: 'anywhere', minWidth: 0 }}>{v}</span>
    </div>
  );
}

interface FinRow {
  invoices: Array<{ id: number; invoice_no: string; invoice_date: string; grand_total_paisa: number; paid_paisa: number; status: string }>;
  payments: Array<{ id: number; receipt_no: string; amount_paisa: number; paid_at: string; reference: string; method: string }>;
  totals: { billed: number; paid: number; outstanding: number };
}

function FinancialHistory({ patientId }: { patientId: number }) {
  const [data, setData] = useState<FinRow | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .patientFinancials(patientId)
      .then((d) => setData(d as unknown as FinRow))
      .catch((e) => setError(e instanceof Error ? e.message : 'No permission or failed to load.'));
  }, [patientId]);

  if (error) return <div className="card"><ErrorState message={error} /></div>;
  if (!data) return <div className="card"><div style={{ padding: 16 }} className="skeleton" /></div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 16 }}>
      <div className="card">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)', display: 'flex', justifyContent: 'space-between' }}>
          <span className="card-title">Invoices</span>
          <span className="dp-sub">
            Billed {formatBDT(data.totals.billed)} · Paid {formatBDT(data.totals.paid)} · <span style={{ color: data.totals.outstanding > 0 ? 'var(--dp-error)' : 'inherit' }}>Outstanding {formatBDT(data.totals.outstanding)}</span>
          </span>
        </div>
        {data.invoices.length === 0 ? (
          <EmptyState icon={<IconWallet size={22} />} title="No invoices yet" desc="Invoices created for this patient will appear here." />
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table">
              <thead>
                <tr><th>Invoice</th><th>Date</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="dp-mono cell-main">{inv.invoice_no}</td>
                    <td>{new Date(inv.invoice_date).toLocaleDateString('en-GB')}</td>
                    <td className="num">{formatBDT(inv.grand_total_paisa)}</td>
                    <td className="num">{formatBDT(inv.paid_paisa)}</td>
                    <td>
                      {inv.status === 'paid' ? <Badge tone="success">Paid</Badge> : inv.status === 'partial' ? <Badge tone="warning">Partially paid</Badge> : inv.status === 'void' ? <Badge tone="neutral">Void</Badge> : <Badge tone="error">Unpaid</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)' }}>
          <span className="card-title">Payments</span>
        </div>
        {data.payments.length === 0 ? (
          <EmptyState icon={<IconWallet size={22} />} title="No payments yet" desc="Payments recorded for this patient will appear here." />
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table">
              <thead>
                <tr><th>Receipt</th><th>Method</th><th className="num">Amount</th><th>Date</th></tr>
              </thead>
              <tbody>
                {data.payments.map((pay) => (
                  <tr key={pay.id}>
                    <td className="dp-mono cell-main">{pay.receipt_no}</td>
                    <td>{pay.method}</td>
                    <td className="num" style={{ color: 'var(--dp-success)', fontWeight: 600 }}>{formatBDT(pay.amount_paisa)}</td>
                    <td className="cell-sub">{new Date(pay.paid_at).toLocaleDateString('en-GB')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
