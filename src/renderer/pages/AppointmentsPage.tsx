import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AppointmentRow, type Dentist, type PatientRow } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Select, Textarea, useToast } from '../components/ui';
import { PatientPicker } from '../components/PatientPicker';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconPlus } from '../components/Icons';

const STATUS_BADGE: Record<string, { tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary'; label: string }> = {
  scheduled: { tone: 'info', label: 'Scheduled' },
  confirmed: { tone: 'primary', label: 'Confirmed' },
  arrived: { tone: 'warning', label: 'Arrived' },
  'in-queue': { tone: 'warning', label: 'In queue' },
  'in-progress': { tone: 'primary', label: 'In progress' },
  completed: { tone: 'success', label: 'Completed' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  'no-show': { tone: 'error', label: 'No show' },
  rescheduled: { tone: 'warning', label: 'Rescheduled' },
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AppointmentsPage({ ctx }: { ctx: NavCtx }) {
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [dentistId, setDentistId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [rescheduling, setRescheduling] = useState<AppointmentRow | null>(null);
  const [cancelling, setCancelling] = useState<AppointmentRow | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.apptAgenda(date, dentistId === 'all' ? null : Number(dentistId));
      setRows(res as unknown as AppointmentRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load appointments.');
    } finally {
      setLoading(false);
    }
  }, [date, dentistId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.dentistsList().then((d) => setDentists(d)).catch(() => undefined);
  }, []);

  const setStatus = async (row: AppointmentRow, status: string) => {
    try {
      await api.apptStatus(row.id, status);
      toast('success', `Appointment ${status.replace('-', ' ')}`);
      void load();
    } catch (e) {
      toast('error', 'Status change failed', e instanceof Error ? e.message : undefined);
    }
  };

  const upcoming = useMemo(() => rows.filter((r) => !['completed', 'cancelled', 'no-show'].includes(r.status)), [rows]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Practice</div>
          <h1>Appointments</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>{upcoming.length} upcoming today · {fmtDate(date)}</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>New appointment</Button>
        </div>
      </div>

      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Button variant="secondary" size="sm" icon={<IconChevronLeft size={15} />} onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="Previous day" />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} aria-label="Appointment date" />
          <Button variant="secondary" size="sm" icon={<IconChevronRight size={15} />} onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="Next day" />
          <Button variant="secondary" size="sm" onClick={() => setDate(todayIso())}>Today</Button>
        </div>
        <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)} style={{ width: 200 }} aria-label="Dentist filter">
          <option value="all">All dentists</option>
          {dentists.map((d) => (
            <option key={d.id} value={d.id}>{d.full_name}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={6} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconCalendar size={24} />}
            title="No appointments on this day"
            desc="Book an appointment for a patient — the scheduler checks dentist availability automatically."
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setCreating(true)}>New appointment</Button>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Time</th>
                <th>Patient</th>
                <th>Dentist</th>
                <th>Type / notes</th>
                <th>Status</th>
                <th style={{ width: 240 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = STATUS_BADGE[r.status] ?? { tone: 'neutral' as const, label: r.status };
                return (
                  <tr key={r.id}>
                    <td className="dp-mono cell-main">{r.start_time}<span className="dp-sub" style={{ marginLeft: 6 }}>{r.duration_minutes}m</span></td>
                    <td>
                      <button className="link" onClick={() => ctx.navigate(`patient:${r.patient_id}`)}>{r.patient_name}</button>
                      {r.patient_code && <span className="dp-sub" style={{ marginLeft: 8 }}>{r.patient_code}</span>}
                    </td>
                    <td>{r.dentist_name ?? <span className="dp-sub">Any</span>}</td>
                    <td className="cell-sub">{[r.appt_type, r.notes].filter(Boolean).join(' — ') || '—'}</td>
                    <td><Badge tone={badge.tone}>{badge.label}</Badge></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {r.status === 'scheduled' && (
                          <Button size="sm" variant="secondary" onClick={() => void setStatus(r, 'confirmed')}>Confirm</Button>
                        )}
                        {(r.status === 'scheduled' || r.status === 'confirmed') && (
                          <Button size="sm" variant="secondary" onClick={() => void setStatus(r, 'arrived')}>Arrived</Button>
                        )}
                        {r.status === 'arrived' && (
                          <Button size="sm" variant="primary" onClick={() => void setStatus(r, 'in-progress')}>Start</Button>
                        )}
                        {r.status === 'in-progress' && (
                          <Button size="sm" variant="primary" onClick={() => void setStatus(r, 'completed')}>Complete</Button>
                        )}
                        {!['completed', 'cancelled', 'no-show'].includes(r.status) && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setRescheduling(r)}>Reschedule</Button>
                            <Button size="sm" variant="danger-outline" onClick={() => setCancelling(r)}>Cancel</Button>
                          </>
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

      {creating && (
        <AppointmentEditor
          dentists={dentists}
          defaultDate={date}
          onClose={() => setCreating(false)}
          onSaved={(conflict) => {
            setCreating(false);
            toast(conflict ? 'warning' : 'success', 'Appointment created', conflict ? 'Saved with a scheduling conflict — review the dentist agenda.' : undefined);
            void load();
          }}
        />
      )}

      {rescheduling && (
        <RescheduleDialog
          row={rescheduling}
          onClose={() => setRescheduling(null)}
          onSaved={(conflict) => {
            setRescheduling(null);
            toast(conflict ? 'warning' : 'success', 'Appointment rescheduled');
            void load();
          }}
        />
      )}

      {cancelling && (
        <CancelDialog
          row={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            toast('success', 'Appointment cancelled');
            void load();
          }}
        />
      )}
    </div>
  );
}

function AppointmentEditor({
  dentists,
  defaultDate,
  onClose,
  onSaved,
}: {
  dentists: Dentist[];
  defaultDate: string;
  onClose: () => void;
  onSaved: (conflict: boolean) => void;
}) {
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState('30');
  const [dentistId, setDentistId] = useState('');
  const [type, setType] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!patient) {
      setError('Choose a patient for this appointment.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.apptCreate({
        patientId: patient.id,
        dentistId: dentistId ? Number(dentistId) : null,
        apptDate: date,
        startTime: time,
        durationMinutes: Number(duration),
        apptType: type.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSaved(res.conflict);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the appointment.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New appointment"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Book appointment</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Patient" required error={error && !patient ? error : undefined} className="field-full">
          {patient ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Input value={`${patient.full_name} (${patient.patient_code})`} readOnly />
              <Button variant="secondary" onClick={() => setPicking(true)}>Change</Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setPicking(true)}>Select patient…</Button>
          )}
        </Field>
        <Field label="Dentist" hint="Any dentist if left empty">
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
            <option value="">Any dentist</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Start time" required>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Duration (minutes)" required>
          <Input type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
        <Field label="Type">
          <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. Scaling, RCT follow-up" />
        </Field>
        <Field label="Notes" className="field-full">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional clinical or scheduling notes" />
        </Field>
      </div>
      {error && patient && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
      {picking && (
        <PatientPicker
          title="Choose patient for appointment"
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

function RescheduleDialog({ row, onClose, onSaved }: { row: AppointmentRow; onClose: () => void; onSaved: (conflict: boolean) => void }) {
  const [date, setDate] = useState(row.appt_date);
  const [time, setTime] = useState(row.start_time);
  const [duration, setDuration] = useState(String(row.duration_minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.apptReschedule(row.id, date, time, Number(duration));
      onSaved(res.conflict);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reschedule.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Reschedule — ${row.patient_name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Save new slot</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Start time" required><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Duration"><Input type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

function CancelDialog({ row, onClose, onDone }: { row: AppointmentRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { toast } = useToast();

  return (
    <Modal
      title="Cancel appointment"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Keep appointment</Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api.apptCancel(row.id, reason);
                onDone();
              } catch (e) {
                toast('error', 'Cancel failed', e instanceof Error ? e.message : undefined);
              }
            }}
          >
            Cancel appointment
          </Button>
        </>
      }
    >
      <div className="alert alert-error" style={{ marginBottom: 12 }}>
        The {row.appt_date} {row.start_time} slot for <strong>{row.patient_name}</strong> will be released. The cancellation is recorded in the audit trail.
      </div>
      <Field label="Reason (optional)">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. patient unavailable" autoFocus />
      </Field>
    </Modal>
  );
}
