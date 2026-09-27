import { useCallback, useEffect, useState } from 'react';
import { api, type Dentist, type PatientRow, type QueueRow } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Select, useToast } from '../components/ui';
import { PatientPicker } from '../components/PatientPicker';
import { IconQueue, IconPlus, IconChevronLeft, IconChevronRight } from '../components/Icons';

const Q_STATUS: Record<string, { tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary'; label: string }> = {
  waiting: { tone: 'info', label: 'Waiting' },
  'in-treatment': { tone: 'primary', label: 'In treatment' },
  completed: { tone: 'success', label: 'Completed' },
  skipped: { tone: 'warning', label: 'Skipped' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function QueuePage({ ctx }: { ctx: NavCtx }) {
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.queueList(date);
      setRows(res as unknown as QueueRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load queue.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.dentistsList().then((d) => setDentists(d)).catch(() => undefined);
  }, []);

  const setStatus = async (row: QueueRow, status: string) => {
    try {
      await api.queueStatus(row.id, status);
      toast('success', `Queue ${status.replace('-', ' ')}`);
      void load();
    } catch (e) {
      toast('error', 'Status change failed', e instanceof Error ? e.message : undefined);
    }
  };

  const waiting = rows.filter((r) => r.status === 'waiting').length;
  const active = rows.filter((r) => r.status === 'in-treatment').length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Practice</div>
          <h1>Patient Queue</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>{waiting} waiting · {active} in treatment</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCheckingIn(true)}>Check in patient</Button>
        </div>
      </div>

      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Button variant="secondary" size="sm" icon={<IconChevronLeft size={15} />} onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="Previous day" />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} aria-label="Queue date" />
          <Button variant="secondary" size="sm" icon={<IconChevronRight size={15} />} onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="Next day" />
          <Button variant="secondary" size="sm" onClick={() => setDate(todayIso())}>Today</Button>
        </div>
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={6} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconQueue size={24} />}
            title="No one in the queue"
            desc="Check in an arriving patient, or send a scheduled appointment straight into the queue."
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setCheckingIn(true)}>Check in patient</Button>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>No.</th>
                <th>Patient</th>
                <th>Dentist</th>
                <th>Reason</th>
                <th>Status</th>
                <th style={{ width: 240 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = Q_STATUS[r.status] ?? { tone: 'neutral' as const, label: r.status };
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="badge badge-primary" style={{ fontSize: 14, fontWeight: 700 }}>{r.queue_no}</span>
                    </td>
                    <td>
                      <button className="link" onClick={() => ctx.navigate(`patient:${r.patient_id}`)}>{r.patient_name}</button>
                      <span className="dp-sub" style={{ marginLeft: 8 }}>{r.patient_code}</span>
                      {r.priority ? <Badge tone="error">Priority</Badge> : null}
                    </td>
                    <td>{r.dentist_name ?? <span className="dp-sub">Any</span>}</td>
                    <td className="cell-sub">{r.reason || '—'}</td>
                    <td><Badge tone={badge.tone}>{badge.label}</Badge></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {r.status === 'waiting' && (
                          <>
                            <Button size="sm" variant="primary" onClick={() => void setStatus(r, 'in-treatment')}>Start</Button>
                            <Button size="sm" variant="ghost" onClick={() => void setStatus(r, 'skipped')}>Skip</Button>
                          </>
                        )}
                        {r.status === 'in-treatment' && (
                          <Button size="sm" variant="primary" onClick={() => void setStatus(r, 'completed')}>Complete</Button>
                        )}
                        {(r.status === 'waiting' || r.status === 'in-treatment') && (
                          <Button size="sm" variant="danger-outline" onClick={() => void setStatus(r, 'cancelled')}>Cancel</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {checkingIn && (
        <CheckInDialog
          dentists={dentists}
          onClose={() => setCheckingIn(false)}
          onSaved={(q) => {
            setCheckingIn(false);
            toast('success', `Checked in as #${q.queueNo}`);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CheckInDialog({ dentists, onClose, onSaved }: { dentists: Dentist[]; onClose: () => void; onSaved: (q: { id: number; queueNo: number }) => void }) {
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [picking, setPicking] = useState(true);
  const [dentistId, setDentistId] = useState('');
  const [priority, setPriority] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!patient && picking) {
    return (
      <PatientPicker
        title="Check in a patient"
        onClose={onClose}
        onPick={(p) => {
          setPatient(p);
          setPicking(false);
        }}
      />
    );
  }
  if (!patient) return null;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.queueCheckIn(patient.id, dentistId ? Number(dentistId) : null, null, priority, reason.trim() || undefined);
      onSaved(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check in.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Check in — ${patient.full_name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => setPicking(true)}>Different patient</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Add to queue</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Dentist">
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
            <option value="">Any dentist</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pain, follow-up" />
        </Field>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
        <span>Mark as priority (moves to the front)</span>
      </label>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}
