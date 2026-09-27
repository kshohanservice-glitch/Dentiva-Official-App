import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, EmptyState, ErrorState } from '../components/ui';
import {
  IconCalendar, IconUsers, IconQueue, IconCheck, IconAlert, IconWallet,
  IconBox, IconActivity, IconPlus,
} from '../components/Icons';
import { formatBDT } from '../../shared/money';

interface Stats {
  today: string;
  appointmentsToday: number;
  newPatientsToday: number;
  totalPatients: number;
  waitingQueue: number;
  inTreatment: number;
  completedVisitsToday: number;
  missedToday: number;
  revenueTodayPaisa: number;
  outstandingPaisa: number;
  lowStockItems: number;
  expiringItems: number;
  canSeeFinancial: boolean;
  recentPatients: Array<{ id: number; patient_code: string; full_name: string; phone: string; created_at: string }>;
  upcomingAppointments: Array<{ id: number; appt_date: string; start_time: string; status: string; patient_name: string; patient_id: number; dentist_name: string | null }>;
  recentPayments: Array<{ amount_paisa: number; paid_at: string; receipt_no: string; method: string; patient_name: string }>;
  last7Revenue: Array<{ day: string; total: number }>;
}

export function DashboardPage({ ctx }: { ctx: NavCtx }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setStats((await api.callDashboard()) as unknown as Stats);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !stats) return <ErrorState message={error} onRetry={() => void load()} />;

  if (!stats) {
    return (
      <div className="page">
        <div className="stat-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 88, borderRadius: 14 }} />
          ))}
        </div>
      </div>
    );
  }

  const max7 = Math.max(1, ...stats.last7Revenue.map((r) => r.total));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Practice</div>
          <h1>Dashboard</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>
            Clinic overview for {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => ctx.navigate('patients')}>
            <IconPlus size={16} /> New Patient
          </button>
        </div>
      </div>

      {/* Stat cards: balanced grid */}
      <div className="stat-grid">
        <StatCard icon={<IconCalendar size={19} />} tone="teal" label="Today's appointments" value={String(stats.appointmentsToday)} sub={`${stats.missedToday} no-show`} />
        <StatCard icon={<IconUsers size={19} />} tone="blue" label="New patients today" value={String(stats.newPatientsToday)} sub={`${stats.totalPatients} total patients`} />
        <StatCard icon={<IconQueue size={19} />} tone="amber" label="Waiting in queue" value={String(stats.waitingQueue)} sub={`${stats.inTreatment} in treatment`} />
        <StatCard icon={<IconCheck size={19} />} tone="green" label="Completed visits today" value={String(stats.completedVisitsToday)} sub="from visit records" />
        {stats.canSeeFinancial && (
          <>
            <StatCard icon={<IconWallet size={19} />} tone="green" label="Today's revenue" value={formatBDT(stats.revenueTodayPaisa)} sub="payments received today" />
            <StatCard icon={<IconAlert size={19} />} tone="red" label="Outstanding balances" value={formatBDT(stats.outstandingPaisa)} sub="unpaid & partial invoices" />
          </>
        )}
        <StatCard icon={<IconBox size={19} />} tone={stats.lowStockItems > 0 ? 'red' : 'slate'} label="Low-stock items" value={String(stats.lowStockItems)} sub={`${stats.expiringItems} expiring ≤ 30 days`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 16, marginTop: 16 }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="card">
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">Upcoming appointments</span>
              <button className="muted-link" onClick={() => ctx.navigate('appointments')}>View all</button>
            </div>
            {stats.upcomingAppointments.length === 0 ? (
              <EmptyState title="No upcoming appointments" desc="New appointments will appear here." icon={<IconCalendar size={22} />} />
            ) : (
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Patient</th>
                      <th>Dentist</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.upcomingAppointments.map((a) => (
                      <tr key={a.id} className="clickable" onClick={() => ctx.navigate(`patient:${a.patient_id}`)}>
                        <td>{a.appt_date}</td>
                        <td>{a.start_time}</td>
                        <td className="cell-main">{a.patient_name}</td>
                        <td>{a.dentist_name ?? '—'}</td>
                        <td>
                          <ApptStatusBadge status={a.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {stats.canSeeFinancial && (
            <div className="card card-pad">
              <span className="card-title" style={{ marginBottom: 12 }}>Payments — last 7 days</span>
              {stats.last7Revenue.length === 0 ? (
                <div className="dp-sub">No payments recorded in the last 7 days.</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120 }}>
                  {lastSevenDays().map((day) => {
                    const row = stats.last7Revenue.find((r) => r.day === day);
                    const h = row ? Math.max(4, Math.round((row.total / max7) * 100)) : 4;
                    return (
                      <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }} title={row ? formatBDT(row.total) : 'No payments'}>
                        <div style={{ width: '70%', maxWidth: 36, height: `${h}%`, minHeight: 4, background: row ? 'var(--dp-primary-500)' : 'var(--dp-surface-sunken)', borderRadius: '6px 6px 2px 2px' }} />
                        <span style={{ fontSize: 11, color: 'var(--dp-text-faint)' }}>{day.slice(8)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="card">
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">Recent patients</span>
              <button className="muted-link" onClick={() => ctx.navigate('patients')}>View all</button>
            </div>
            {stats.recentPatients.length === 0 ? (
              <EmptyState title="No patients yet" desc="Create your first patient to get started." icon={<IconUsers size={22} />} />
            ) : (
              <div>
                {stats.recentPatients.map((p) => (
                  <div key={p.id} className="notif-item" onClick={() => ctx.navigate(`patient:${p.id}`)}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--dp-primary-50)', color: 'var(--dp-primary-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flex: 'none' }}>
                      {p.full_name.slice(0, 1)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{p.full_name}</div>
                      <div className="b">
                        {p.patient_code} · {p.phone || 'no phone'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {stats.canSeeFinancial && (
            <div className="card">
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)' }}>
                <span className="card-title">Recent payments</span>
              </div>
              {stats.recentPayments.length === 0 ? (
                <EmptyState title="No payments yet" desc="Recorded payments will appear here." icon={<IconWallet size={22} />} />
              ) : (
                <div>
                  {stats.recentPayments.map((p, i) => (
                    <div key={i} className="notif-item" style={{ cursor: 'default' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="t">{p.patient_name}</div>
                        <div className="b">
                          {p.receipt_no} · {p.method}
                        </div>
                        <div className="w">{new Date(p.paid_at).toLocaleString('en-GB')}</div>
                      </div>
                      <span className="dp-strong" style={{ color: 'var(--dp-success)', flex: 'none' }}>
                        {formatBDT(p.amount_paisa)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card card-pad">
            <span className="card-title" style={{ marginBottom: 10 }}>
              <IconActivity size={15} /> Quick actions
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <QuickAction label="New patient" onClick={() => ctx.navigate('patients')} />
              <QuickAction label="Appointments" onClick={() => ctx.navigate('appointments')} />
              <QuickAction label="Queue" onClick={() => ctx.navigate('queue')} />
              <QuickAction label="Prescriptions" onClick={() => ctx.navigate('prescriptions')} />
              <QuickAction label="Invoices" onClick={() => ctx.navigate('invoices')} />
              <QuickAction label="Backup" onClick={() => ctx.navigate('backup')} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="btn btn-secondary btn-sm" onClick={onClick}>
      {label}
    </button>
  );
}

function StatCard({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: 'teal' | 'green' | 'amber' | 'red' | 'blue' | 'slate'; label: string; value: string; sub?: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value" title={value}>{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function ApptStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary'; label: string }> = {
    scheduled: { tone: 'info', label: 'Scheduled' },
    confirmed: { tone: 'primary', label: 'Confirmed' },
    arrived: { tone: 'primary', label: 'Arrived' },
    'in-queue': { tone: 'warning', label: 'In Queue' },
    'in-progress': { tone: 'warning', label: 'In Progress' },
    completed: { tone: 'success', label: 'Completed' },
    cancelled: { tone: 'neutral', label: 'Cancelled' },
    'no-show': { tone: 'error', label: 'No-show' },
    rescheduled: { tone: 'info', label: 'Rescheduled' },
  };
  const m = map[status] ?? { tone: 'neutral' as const, label: status };
  return <Badge tone={m.tone} dot>{m.label}</Badge>;
}

function lastSevenDays(): string[] {
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}


