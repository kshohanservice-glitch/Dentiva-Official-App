import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type AttachmentRow,
  type ChartData,
  type Dentist,
  type ReferralRow,
  type TimelineEvent,
  type TreatmentRecordRow,
  type TreatmentRow,
  type VisitRow,
} from '../lib/api';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Select, Textarea, useToast } from '../components/ui';
import { IconPlus, IconTrash, IconEye, IconDownload, IconFileText, IconClock } from '../components/Icons';
import { formatBDT, parseAmountToPaisa } from '../../shared/money';

/* =============================== Visits =============================== */

export function VisitsTab({ patientId, dentists }: { patientId: number; dentists: Dentist[] }) {
  const [rows, setRows] = useState<VisitRow[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<VisitRow | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await api.visitsList(patientId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load visits.');
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!rows) return <div className="card"><LoadingRows rows={4} /></div>;

  return (
    <div className="card">
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="card-title">Visits ({rows.length})</span>
        <Button size="sm" variant="primary" icon={<IconPlus size={14} />} onClick={() => setCreating(true)}>New visit</Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No visits recorded" desc="Record the first consultation for this patient." />
      ) : (
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Dentist</th><th>Chief complaint</th><th>Diagnosis</th><th>Status</th><th style={{ width: 130 }}></th></tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <Fragment key={v.id}>
                  <tr className="clickable" onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                    <td className="cell-main">{new Date(v.visit_date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{v.dentist_name ?? '—'}</td>
                    <td className="cell-sub" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.chief_complaint || '—'}</td>
                    <td className="cell-sub" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.diagnosis || '—'}</td>
                    <td>{v.status === 'completed' ? <Badge tone="success">Completed</Badge> : v.status === 'in-progress' ? <Badge tone="info">In progress</Badge> : <Badge tone="neutral">Cancelled</Badge>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="ghost" icon={<IconEye size={14} />} onClick={() => setExpanded(expanded === v.id ? null : v.id)} aria-label="View visit" />
                        <Button size="sm" variant="ghost" icon={<IconTrash size={14} />} onClick={() => setDeleting(v)} aria-label="Delete visit" />
                      </div>
                    </td>
                  </tr>
                  {expanded === v.id && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--dp-surface-2)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, padding: 12 }}>
                          <VisitKV k="History" v={v.history} />
                          <VisitKV k="Examination" v={v.examination} />
                          <VisitKV k="Treatment" v={v.treatment} />
                          <VisitKV k="Advice" v={v.advice} />
                          <VisitKV k="Follow-up" v={v.follow_up} />
                          <VisitKV k="Clinical notes" v={v.clinical_notes} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <VisitEditor
          patientId={patientId}
          dentists={dentists}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            toast('success', 'Visit recorded');
            void load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete visit record?"
          danger
          confirmLabel="Delete visit"
          message={`Delete the visit from ${new Date(deleting.visit_date).toLocaleString('en-GB')}? This is a soft delete — the audit trail keeps the action.`}
          onConfirm={async () => {
            try {
              await api.visitDelete(deleting.id);
              toast('success', 'Visit deleted');
              setDeleting(null);
              void load();
            } catch (e) {
              toast('error', 'Delete failed', e instanceof Error ? e.message : undefined);
            }
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function VisitKV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--dp-text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
      <div style={{ fontSize: 13, marginTop: 2, whiteSpace: 'pre-wrap' }}>{v || '—'}</div>
    </div>
  );
}

function VisitEditor({ patientId, dentists, onClose, onSaved }: { patientId: number; dentists: Dentist[]; onClose: () => void; onSaved: () => void }) {
  const [dentistId, setDentistId] = useState('');
  const [chief, setChief] = useState('');
  const [history, setHistory] = useState('');
  const [exam, setExam] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [treatment, setTreatment] = useState('');
  const [advice, setAdvice] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('completed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.visitCreate({
        patientId,
        dentistId: dentistId ? Number(dentistId) : null,
        chiefComplaint: chief.trim() || undefined,
        history: history.trim() || undefined,
        examination: exam.trim() || undefined,
        diagnosis: diagnosis.trim() || undefined,
        treatment: treatment.trim() || undefined,
        advice: advice.trim() || undefined,
        followUp: followUp.trim() || undefined,
        clinicalNotes: notes.trim() || undefined,
        status: status as 'completed' | 'in-progress' | 'cancelled',
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save visit.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New visit"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Save visit</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Dentist">
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
            <option value="">— none —</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="completed">Completed</option>
            <option value="in-progress">In progress</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Chief complaint" className="field-full"><Textarea rows={2} value={chief} onChange={(e) => setChief(e.target.value)} /></Field>
        <Field label="History"><Textarea rows={2} value={history} onChange={(e) => setHistory(e.target.value)} /></Field>
        <Field label="Examination"><Textarea rows={2} value={exam} onChange={(e) => setExam(e.target.value)} /></Field>
        <Field label="Diagnosis"><Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} /></Field>
        <Field label="Treatment performed"><Input value={treatment} onChange={(e) => setTreatment(e.target.value)} /></Field>
        <Field label="Advice"><Input value={advice} onChange={(e) => setAdvice(e.target.value)} /></Field>
        <Field label="Follow-up"><Input value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="e.g. Review in 2 weeks" /></Field>
        <Field label="Clinical notes" className="field-full"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

/* =============================== Dental chart =============================== */

const ADULT_ROWS: number[][] = [
  [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
];
const PEDIATRIC_ROWS: number[][] = [
  [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
];

const CONDITION_COLORS: Record<string, string> = {
  caries: 'var(--dp-warning)',
  restoration: 'var(--dp-info)',
  missing: 'var(--dp-text-faint)',
  extraction: 'var(--dp-error)',
  rct: 'var(--dp-primary-600, #2563eb)',
  crown: '#8b5cf6',
  fracture: '#f97316',
  mobility: '#eab308',
  impacted: '#64748b',
  infection: '#dc2626',
  other: '#94a3b8',
};

export function ChartTab({ patientId, dentists }: { patientId: number; dentists: Dentist[] }) {
  const [data, setData] = useState<ChartData | null>(null);
  const [conditions, setConditions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [historyTooth, setHistoryTooth] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError('');
    try {
      const [chart, conds] = await Promise.all([api.chartCurrent(patientId), api.chartConditions()]);
      setData(chart);
      setConditions(conds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chart.');
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!data) return <div className="card"><LoadingRows rows={4} /></div>;

  const renderTooth = (t: number) => {
    const entry = data.teeth[String(t)];
    const color = entry ? CONDITION_COLORS[entry.condition] ?? '#94a3b8' : 'transparent';
    return (
      <button
        key={t}
        onClick={() => setHistoryTooth(t)}
        title={entry ? `${t}: ${entry.condition}${entry.surface ? ` (${entry.surface})` : ''}${entry.note ? ` — ${entry.note}` : ''}` : `${t}: no findings`}
        style={{
          width: 34,
          height: 40,
          borderRadius: 7,
          border: `2px solid ${entry ? color : 'var(--dp-divider)'}`,
          background: entry ? `${color}22` : 'var(--dp-surface)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
        }}
        aria-label={`Tooth ${t}${entry ? `, ${entry.condition}` : ', no findings'}`}
      >
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>{t}</span>
        {entry && <span style={{ fontSize: 8, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{entry.condition.slice(0, 5)}</span>}
      </button>
    );
  };

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="card-title">Dental chart (FDI)</span>
        <Button size="sm" variant="primary" icon={<IconPlus size={14} />} onClick={() => setAdding(true)}>Record finding</Button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 620 }}>
          <div className="dp-sub" style={{ fontSize: 11, fontWeight: 700 }}>PERMANENT DENTITION — UPPER</div>
          <div style={{ display: 'flex', gap: 4 }}>{ADULT_ROWS[0].map(renderTooth)}</div>
          <div className="dp-sub" style={{ fontSize: 11, fontWeight: 700 }}>PERMANENT DENTITION — LOWER</div>
          <div style={{ display: 'flex', gap: 4 }}>{ADULT_ROWS[1].map(renderTooth)}</div>
          <div className="dp-sub" style={{ fontSize: 11, fontWeight: 700, marginTop: 8 }}>PRIMARY (DECIDUOUS) DENTITION</div>
          <div style={{ display: 'flex', gap: 4 }}>{PEDIATRIC_ROWS[0].map(renderTooth)}</div>
          <div style={{ display: 'flex', gap: 4 }}>{PEDIATRIC_ROWS[1].map(renderTooth)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        {conditions.map((c) => (
          <span key={c} className="dp-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: CONDITION_COLORS[c] ?? '#94a3b8' }} />
            {c}
          </span>
        ))}
      </div>

      {data.rows.length === 0 && (
        <div className="dp-sub" style={{ marginTop: 12 }}>No chart findings recorded yet. Click any tooth to open its history, or record a finding.</div>
      )}

      {adding && (
        <ChartEntryDialog
          patientId={patientId}
          dentists={dentists}
          conditions={conditions}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            toast('success', 'Chart finding recorded');
            void load();
          }}
        />
      )}

      {historyTooth !== null && (
        <ToothHistoryDialog
          patientId={patientId}
          tooth={historyTooth}
          onClose={() => setHistoryTooth(null)}
          onCleared={() => {
            setHistoryTooth(null);
            toast('success', 'Tooth chart cleared (history retained)');
            void load();
          }}
        />
      )}
    </div>
  );
}

function ChartEntryDialog({ patientId, dentists, conditions, onClose, onSaved }: { patientId: number; dentists: Dentist[]; conditions: string[]; onClose: () => void; onSaved: () => void }) {
  const [teeth, setTeeth] = useState<number[]>([]);
  const [condition, setCondition] = useState(conditions[0] ?? 'caries');
  const [surface, setSurface] = useState('');
  const [note, setNote] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (t: number) => setTeeth((arr) => (arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t].sort((a, b) => a - b)));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (teeth.length === 0) throw new Error('Select at least one tooth.');
      const res = await api.chartAdd({
        patientId,
        teeth,
        condition,
        surface: surface.trim() || undefined,
        note: note.trim() || undefined,
        dentistId: dentistId ? Number(dentistId) : null,
      });
      if (res.created !== teeth.length) {
        throw new Error(`Only ${res.created} of ${teeth.length} teeth accepted (duplicate conditions are ignored).`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save chart entry.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Record chart finding"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Save finding</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Field label="Condition" required>
          <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
            {conditions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Surface" hint="e.g. mesial, occlusal">
          <Input value={surface} onChange={(e) => setSurface(e.target.value)} />
        </Field>
        <Field label="Dentist">
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
            <option value="">— none —</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note" className="field-full">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional clinical note" />
        </Field>
      </div>
      <Field label="Teeth" required hint={`${teeth.length} selected`}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {[...ADULT_ROWS.flat(), ...PEDIATRIC_ROWS.flat()].map((t) => (
            <button
              key={t}
              onClick={() => toggle(t)}
              style={{
                width: 38,
                height: 30,
                borderRadius: 6,
                border: teeth.includes(t) ? '2px solid var(--dp-primary-600, #2563eb)' : '1px solid var(--dp-divider)',
                background: teeth.includes(t) ? 'var(--dp-primary-50, #eff6ff)' : 'var(--dp-surface)',
                fontWeight: teeth.includes(t) ? 700 : 400,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

function ToothHistoryDialog({ patientId, tooth, onClose, onCleared }: { patientId: number; tooth: number; onClose: () => void; onCleared: () => void }) {
  const [rows, setRows] = useState<Array<{ id: number; condition: string; surface: string; note: string; dentist_name: string | null; created_at: string; superseded_at: string | null }> | null>(null);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api
      .chartToothHistory(patientId, tooth)
      .then((r) => setRows(r as never))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load history.'));
  }, [patientId, tooth]);

  return (
    <Modal
      title={`Tooth ${tooth} — history`}
      onClose={onClose}
      footer={
        rows && rows.length > 0 ? (
          <>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="danger-outline" onClick={() => setClearing(true)}>Clear current finding</Button>
          </>
        ) : undefined
      }
    >
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingRows rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState title="No findings on this tooth" desc="Findings recorded on the chart will appear here with their full history." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Condition</th><th>Surface</th><th>Note</th><th>Dentist</th><th>Recorded</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.condition}</td>
                  <td>{r.surface || '—'}</td>
                  <td className="cell-sub">{r.note || '—'}</td>
                  <td>{r.dentist_name ?? '—'}</td>
                  <td>{new Date(r.created_at).toLocaleString('en-GB')}</td>
                  <td>{r.superseded_at ? <Badge tone="neutral">Superseded</Badge> : <Badge tone="success">Current</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {clearing && (
        <ConfirmDialog
          title="Clear this tooth?"
          danger
          confirmLabel="Clear tooth"
          message={`Clear the current finding on tooth ${tooth}? The entry is superseded (kept in history), never hard-deleted.`}
          onConfirm={async () => {
            try {
              await api.chartClearTooth(patientId, tooth);
              onCleared();
            } catch (e) {
              toast('error', 'Clear failed', e instanceof Error ? e.message : undefined);
            }
          }}
          onClose={() => setClearing(false)}
        />
      )}
    </Modal>
  );
}

/* =============================== Prescriptions (patient view) =============================== */

export function PatientPrescriptionsTab({ patientId, onOpenFull }: { patientId: number; onOpenFull: () => void }) {
  const [rows, setRows] = useState<Array<{ id: number; rx_no: string; created_at: string; dentist_name: string | null; medicine_count: number; status: string }> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .rxList({ patientId, page: 1, pageSize: 50 })
      .then((r) => setRows(r.rows as never))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load prescriptions.'));
  }, [patientId]);

  if (error) return <div className="card"><ErrorState message={error} /></div>;
  if (!rows) return <div className="card"><LoadingRows rows={3} /></div>;

  return (
    <div className="card">
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="card-title">Prescriptions ({rows.length})</span>
        <Button size="sm" variant="primary" icon={<IconPlus size={14} />} onClick={onOpenFull}>New prescription</Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No prescriptions" desc="Prescriptions written for this patient will appear here." />
      ) : (
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table className="table">
            <thead><tr><th>Rx</th><th>Issued</th><th>Dentist</th><th className="num">Medicines</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="dp-mono cell-main">{r.rx_no}</td>
                  <td>{new Date(r.created_at).toLocaleString('en-GB')}</td>
                  <td>{r.dentist_name ?? '—'}</td>
                  <td className="num">{r.medicine_count}</td>
                  <td>{r.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Void</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* =============================== Treatment records =============================== */

export function TreatmentRecordsTab({ patientId }: { patientId: number }) {
  const [rows, setRows] = useState<TreatmentRecordRow[] | null>(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError('');
    try {
      setRows((await api.treatmentRecords(patientId)) as unknown as TreatmentRecordRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load treatment records.');
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (r: TreatmentRecordRow, status: string) => {
    try {
      await api.treatmentRecordStatus(r.id, status);
      toast('success', 'Treatment status updated');
      void load();
    } catch (e) {
      toast('error', 'Update failed', e instanceof Error ? e.message : undefined);
    }
  };

  if (error) return <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!rows) return <div className="card"><LoadingRows rows={3} /></div>;

  return (
    <div className="card">
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="card-title">Treatment records ({rows.length})</span>
        <Button size="sm" variant="primary" icon={<IconPlus size={14} />} onClick={() => setRecording(true)}>Record treatment</Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No treatments recorded" desc="Record treatments performed for this patient — the catalog price is snapshotted at billing time." />
      ) : (
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table className="table">
            <thead><tr><th>Treatment</th><th>Tooth</th><th className="num">Price</th><th>Status</th><th>By</th><th style={{ width: 150 }}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-main">{r.treatment_name}</td>
                  <td>{r.tooth_no || '—'}</td>
                  <td className="num">{formatBDT(r.price_paisa)}</td>
                  <td>{r.status === 'completed' ? <Badge tone="success">Completed</Badge> : r.status === 'in-progress' ? <Badge tone="info">In progress</Badge> : <Badge tone="warning">Planned</Badge>}</td>
                  <td className="cell-sub">{r.performed_by_name ?? '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {r.status === 'planned' && <Button size="sm" variant="secondary" onClick={() => void setStatus(r, 'in-progress')}>Start</Button>}
                      {r.status !== 'completed' && <Button size="sm" variant="primary" onClick={() => void setStatus(r, 'completed')}>Complete</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recording && (
        <RecordTreatmentDialog
          patientId={patientId}
          onClose={() => setRecording(false)}
          onSaved={(price) => {
            setRecording(false);
            toast('success', 'Treatment recorded', `Price snapshot: ${formatBDT(price)}`);
            void load();
          }}
        />
      )}
    </div>
  );
}

function RecordTreatmentDialog({ patientId, onClose, onSaved }: { patientId: number; onClose: () => void; onSaved: (price: number) => void }) {
  const [catalog, setCatalog] = useState<TreatmentRow[]>([]);
  const [treatmentId, setTreatmentId] = useState('');
  const [toothNo, setToothNo] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.treatmentsList(false, '').then((t) => setCatalog(t as unknown as TreatmentRow[])).catch(() => undefined);
  }, []);

  const selected = catalog.find((t) => String(t.id) === treatmentId);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!treatmentId) throw new Error('Choose a treatment.');
      const override = price.trim() ? parseAmountToPaisa(price) : null;
      const res = await api.treatmentRecord({
        patientId,
        treatmentId: Number(treatmentId),
        toothNo: toothNo.trim() || undefined,
        pricePaisa: override ?? undefined,
        note: note.trim() || undefined,
        status: 'planned',
      });
      onSaved(res.pricePaisa);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record treatment.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Record treatment"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Record</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Treatment" required className="field-full">
          <Select value={treatmentId} onChange={(e) => { setTreatmentId(e.target.value); const t = catalog.find((x) => String(x.id) === e.target.value); setPrice(t ? (t.default_price_paisa / 100).toFixed(2) : ''); }}>
            <option value="">Select…</option>
            {catalog.map((t) => (
              <option key={t.id} value={t.id}>{t.name} — {formatBDT(t.default_price_paisa)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Price (৳)" hint={selected ? `Catalog price ${formatBDT(selected.default_price_paisa)} — override if needed` : 'Catalog price loaded automatically'}>
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Tooth (FDI)"><Input value={toothNo} onChange={(e) => setToothNo(e.target.value)} placeholder="e.g. 46" /></Field>
        <Field label="Note" className="field-full"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

/* =============================== Referrals =============================== */

export function ReferralsTab({ patientId }: { patientId: number }) {
  const [rows, setRows] = useState<ReferralRow[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError('');
    try {
      setRows((await api.referralsList(patientId)) as unknown as ReferralRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load referrals.');
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (r: ReferralRow, status: string) => {
    try {
      await api.referralStatus(r.id, status);
      toast('success', 'Referral updated');
      void load();
    } catch (e) {
      toast('error', 'Update failed', e instanceof Error ? e.message : undefined);
    }
  };

  if (error) return <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!rows) return <div className="card"><LoadingRows rows={3} /></div>;

  return (
    <div className="card">
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="card-title">Referrals ({rows.length})</span>
        <Button size="sm" variant="primary" icon={<IconPlus size={14} />} onClick={() => setCreating(true)}>New referral</Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No referrals" desc="Outgoing referrals to specialists or other clinics are tracked here." />
      ) : (
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table className="table">
            <thead><tr><th>Date</th><th>Referred to</th><th>Reason</th><th>Status</th><th style={{ width: 220 }}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.referred_at).toLocaleDateString('en-GB')}</td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{r.referred_to_doctor}</span>
                    {r.referred_to_clinic && <span className="dp-sub"> — {r.referred_to_clinic}</span>}
                  </td>
                  <td className="cell-sub">{r.reason || '—'}</td>
                  <td>{referralBadge(r.status)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {r.status === 'referred' && <Button size="sm" variant="secondary" onClick={() => void updateStatus(r, 'follow-up')}>Follow-up</Button>}
                      {(r.status === 'referred' || r.status === 'follow-up') && <Button size="sm" variant="primary" onClick={() => void updateStatus(r, 'completed')}>Completed</Button>}
                      {r.status !== 'completed' && r.status !== 'cancelled' && <Button size="sm" variant="ghost" onClick={() => void updateStatus(r, 'cancelled')}>Cancel</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <ReferralDialog
          patientId={patientId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            toast('success', 'Referral created');
            void load();
          }}
        />
      )}
    </div>
  );
}

function referralBadge(status: string) {
  if (status === 'completed') return <Badge tone="success">Completed</Badge>;
  if (status === 'follow-up') return <Badge tone="warning">Follow-up</Badge>;
  if (status === 'cancelled') return <Badge tone="neutral">Cancelled</Badge>;
  return <Badge tone="info">Referred</Badge>;
}

function ReferralDialog({ patientId, onClose, onSaved }: { patientId: number; onClose: () => void; onSaved: () => void }) {
  const [doctor, setDoctor] = useState('');
  const [clinic, setClinic] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.referralCreate({
        patientId,
        referredToDoctor: doctor.trim(),
        referredToClinic: clinic.trim() || undefined,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
        followUpDate: followUpDate || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create referral.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New referral"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Create referral</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Referred to (doctor)" required className="field-full"><Input value={doctor} onChange={(e) => setDoctor(e.target.value)} autoFocus /></Field>
        <Field label="Clinic / hospital"><Input value={clinic} onChange={(e) => setClinic(e.target.value)} /></Field>
        <Field label="Follow-up date"><Input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} /></Field>
        <Field label="Reason" className="field-full"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Surgical extraction of impacted 38" /></Field>
        <Field label="Notes" className="field-full"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

/* =============================== Timeline =============================== */

const TIMELINE_FILTERS = [
  { id: '', label: 'Everything' },
  { id: 'visit', label: 'Visits' },
  { id: 'chart', label: 'Chart' },
  { id: 'treatment', label: 'Treatments' },
  { id: 'prescription', label: 'Prescriptions' },
  { id: 'invoice', label: 'Invoices' },
  { id: 'payment', label: 'Payments' },
  { id: 'referral', label: 'Referrals' },
  { id: 'attachment', label: 'Files' },
];

export function TimelineTab({ patientId }: { patientId: number }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api
      .timeline(patientId, filter)
      .then((e) => setEvents(e))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load timeline.'));
  }, [patientId, filter]);

  if (error) return <div className="card"><ErrorState message={error} /></div>;
  if (!events) return <div className="card"><LoadingRows rows={5} /></div>;

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <span className="card-title">Clinical timeline</span>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 180 }} aria-label="Timeline filter">
          {TIMELINE_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </Select>
      </div>
      {events.length === 0 ? (
        <EmptyState icon={<IconClock size={22} />} title="Nothing here yet" desc="Every visit, chart finding, treatment, prescription, invoice, payment, referral and file is assembled here chronologically." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {events.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, padding: '10px 0', borderBottom: i === events.length - 1 ? 'none' : '1px solid var(--dp-divider)' }}>
              <div style={{ width: 150, flex: 'none' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{new Date(ev.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                <div className="dp-sub" style={{ fontSize: 11 }}>{new Date(ev.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge tone={badgeForType(ev.type)}>{ev.type}</Badge>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{ev.title}</span>
                </div>
                {ev.detail && <div className="dp-sub" style={{ fontSize: 12.5, marginTop: 3, whiteSpace: 'pre-wrap' }}>{ev.detail}</div>}
                {ev.who && <div className="dp-sub" style={{ fontSize: 11, marginTop: 2 }}>by {ev.who}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function badgeForType(type: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary' {
  if (type === 'payment') return 'success';
  if (type === 'invoice') return 'primary';
  if (type === 'prescription') return 'warning';
  if (type === 'referral') return 'info';
  if (type === 'chart' || type === 'treatment' || type === 'visit') return 'info';
  return 'neutral';
}

/* =============================== Attachments =============================== */

export function AttachmentsCard({ patientId }: { patientId: number }) {
  const [rows, setRows] = useState<AttachmentRow[] | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [deleting, setDeleting] = useState<AttachmentRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await api.attachmentsList('patient', patientId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load files.');
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFile = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast('error', 'File too large', 'Attachments are limited to 8 MB.');
      return;
    }
    setUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
      });
      await api.attachmentAdd({ entityType: 'patient', entityId: patientId, fileName: file.name, dataBase64, note: note.trim() || undefined });
      toast('success', 'File attached', file.name);
      setNote('');
      void load();
    } catch (e) {
      toast('error', 'Upload failed', e instanceof Error ? e.message : undefined);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const download = async (a: AttachmentRow) => {
    try {
      const res = await api.attachmentRead(a.id);
      const bytes = Uint8Array.from(atob(res.dataBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: res.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = res.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast('error', 'Download failed', e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <div className="card">
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="card-title">Files &amp; attachments</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" style={{ width: 160 }} />
          <Button size="sm" variant="primary" icon={<IconPlus size={14} />} loading={uploading} onClick={() => fileRef.current?.click()}>
            Attach file
          </Button>
          <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </div>
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : !rows ? (
        <LoadingRows rows={2} />
      ) : rows.length === 0 ? (
        <div className="dp-sub" style={{ padding: 16 }}>
          Attach X-rays, lab reports or consent forms (PDF, JPG, PNG, and common documents up to 8 MB). Files are stored
          locally in the encrypted data folder.
        </div>
      ) : (
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table className="table">
            <thead><tr><th>File</th><th>Note</th><th className="num">Size</th><th>Uploaded</th><th style={{ width: 110 }}></th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="cell-main"><IconFileText size={14} /> {a.original_name}</td>
                  <td className="cell-sub">{a.note || '—'}</td>
                  <td className="num">{(a.size_bytes / 1024).toFixed(0)} KB</td>
                  <td>{new Date(a.created_at).toLocaleString('en-GB')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="ghost" icon={<IconDownload size={14} />} onClick={() => void download(a)} aria-label="Download file" />
                      <Button size="sm" variant="ghost" icon={<IconTrash size={14} />} onClick={() => setDeleting(a)} aria-label="Delete file" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete file?"
          danger
          confirmLabel="Delete file"
          message={`Delete "${deleting.original_name}"? The file is removed from storage and cannot be recovered.`}
          onConfirm={async () => {
            try {
              await api.attachmentDelete(deleting.id);
              toast('success', 'File deleted');
              setDeleting(null);
              void load();
            } catch (e) {
              toast('error', 'Delete failed', e instanceof Error ? e.message : undefined);
            }
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
