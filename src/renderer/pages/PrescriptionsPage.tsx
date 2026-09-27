import { useCallback, useEffect, useState } from 'react';
import { api, type Dentist, type PatientRow } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Pagination, SearchInput, Select, useToast } from '../components/ui';
import { PatientPicker } from '../components/PatientPicker';
import { IconPill, IconPlus, IconEye, IconTrash, IconPrinter } from '../components/Icons';

interface RxListItem {
  id: number;
  rx_no: string;
  created_at: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  dentist_name: string | null;
  medicine_count: number;
  status: string;
}

interface Medicine {
  id: number;
  name: string;
  generic_name: string;
  form: string;
  strength: string;
}

interface RxFull {
  id: number;
  rx_no: string;
  created_at: string;
  status: string;
  chief_complaint: string;
  on_examination: string;
  relevant_exam: string;
  advice: string;
  additional_notes: string;
  patient_name: string;
  patient_code: string;
  age: number | null;
  gender: string | null;
  dentist_name: string | null;
  dentist_title: string | null;
  registration_no: string | null;
  items: Array<{
    id: number;
    medicine_name: string;
    form: string;
    strength: string;
    dose: string;
    morning: number;
    noon: number;
    night: number;
    before_food: number;
    after_food: number;
    duration: string;
    quantity: string;
    instructions: string;
    prn: number;
  }>;
}

export function PrescriptionsPage({ ctx }: { ctx: NavCtx }) {
  const [rows, setRows] = useState<RxListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
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
      const res = await api.rxList({ search: search || undefined, page, pageSize });
      setRows(res.rows as unknown as RxListItem[]);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prescriptions.');
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Clinical</div>
          <h1>Prescriptions</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>{total} prescriptions · Bengali and English medicine names supported</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>New prescription</Button>
        </div>
      </div>

      <div className="toolbar">
        <SearchInput placeholder="Search by Rx no or patient…" onSearch={(v) => { setSearch(v); setPage(1); }} />
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={8} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconPill size={24} />}
            title="No prescriptions yet"
            desc="Write a prescription for a patient — medicine names can be in বাংলা or English."
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setCreating(true)}>New prescription</Button>}
          />
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Rx</th>
                  <th>Issued</th>
                  <th>Patient</th>
                  <th>Dentist</th>
                  <th className="num">Medicines</th>
                  <th>Status</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="dp-mono cell-main">{r.rx_no}</td>
                    <td>{new Date(r.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>
                      <button className="link" onClick={() => ctx.navigate(`patient:${r.patient_id}`)}>{r.patient_name}</button>
                      <span className="dp-sub" style={{ marginLeft: 8 }}>{r.patient_code}</span>
                    </td>
                    <td>{r.dentist_name ?? '—'}</td>
                    <td className="num">{r.medicine_count}</td>
                    <td>{r.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Void</Badge>}</td>
                    <td>
                      <Button size="sm" variant="ghost" icon={<IconEye size={14} />} onClick={() => setViewing(r.id)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}

      {creating && (
        <PrescriptionEditor
          onClose={() => setCreating(false)}
          onSaved={(id, rxNo) => {
            setCreating(false);
            toast('success', `Prescription ${rxNo} saved`);
            void load();
            setViewing(id);
          }}
        />
      )}

      {viewing !== null && (
        <PrescriptionView
          id={viewing}
          onClose={() => setViewing(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

interface DraftItem {
  medicineName: string;
  medicineId: number | null;
  form: string;
  strength: string;
  dose: string;
  morning: boolean;
  noon: boolean;
  night: boolean;
  beforeFood: boolean;
  afterFood: boolean;
  duration: string;
  instructions: string;
  prn: boolean;
}

const emptyItem = (): DraftItem => ({
  medicineName: '',
  medicineId: null,
  form: 'Tablet',
  strength: '',
  dose: '',
  morning: true,
  noon: false,
  night: true,
  beforeFood: false,
  afterFood: true,
  duration: '',
  instructions: '',
  prn: false,
});

function PrescriptionEditor({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number, rxNo: string) => void }) {
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [picking, setPicking] = useState(false);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [dentistId, setDentistId] = useState('');
  const [catalog, setCatalog] = useState<Medicine[]>([]);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [onExam, setOnExam] = useState('');
  const [advice, setAdvice] = useState('');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.dentistsList().then((d) => setDentists(d)).catch(() => undefined);
    api.medicinesCatalog().then((m) => setCatalog(m as unknown as Medicine[])).catch(() => undefined);
  }, []);

  const setItem = (i: number, patch: Partial<DraftItem>) => {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const submit = async () => {
    setError('');
    if (!patient) {
      setError('Choose the patient for this prescription.');
      return;
    }
    if (items.some((it) => !it.medicineName.trim())) {
      setError('Every medicine line needs a name — remove unused lines.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.rxCreate({
        patientId: patient.id,
        dentistId: dentistId ? Number(dentistId) : null,
        chiefComplaint: chiefComplaint.trim() || undefined,
        onExamination: onExam.trim() || undefined,
        advice: advice.trim() || undefined,
        items: items.map((it) => ({
          medicineName: it.medicineName.trim(),
          medicineId: it.medicineId,
          form: it.form,
          strength: it.strength.trim() || undefined,
          dose: it.dose.trim() || undefined,
          morning: it.morning,
          noon: it.noon,
          night: it.night,
          beforeFood: it.beforeFood,
          afterFood: it.afterFood,
          duration: it.duration.trim() || undefined,
          instructions: it.instructions.trim() || undefined,
          prn: it.prn,
        })),
      });
      onSaved(res.id, res.rxNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save prescription.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New prescription"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Save prescription</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
        <Field label="Prescribing dentist">
          <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
            <option value="">— session user —</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Chief complaint (C/C)"><Input value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} placeholder="e.g. Tooth pain, lower right molar" /></Field>
        <Field label="On examination (O/E)"><Input value={onExam} onChange={(e) => setOnExam(e.target.value)} placeholder="e.g. Deep caries 46" /></Field>
        <Field label="Advice" className="field-full"><Input value={advice} onChange={(e) => setAdvice(e.target.value)} placeholder="e.g. Soft diet, warm saline rinse" /></Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <span className="card-title">Medicines</span>
        <div className="dp-sub" style={{ fontSize: 12, marginTop: 2 }}>বাংলায় ওষুধের নাম লিখতে পারবেন — Unicode fully supported.</div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((it, i) => (
            <div key={i} style={{ border: '1px solid var(--dp-divider)', borderRadius: 10, padding: 12, background: 'var(--dp-surface-2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 36px', gap: 8 }}>
                <Field label="Medicine name" required>
                  <Input
                    list="medicine-catalog"
                    value={it.medicineName}
                    onChange={(e) => {
                      const v = e.target.value;
                      const match = catalog.find((m) => m.name.toLowerCase() === v.toLowerCase());
                      setItem(i, { medicineName: v, medicineId: match?.id ?? null, form: match?.form ?? it.form, strength: match?.strength ?? it.strength });
                    }}
                    placeholder="e.g. Napa Extend / প্যারাসিটামল"
                  />
                </Field>
                <Field label="Form">
                  <Select value={it.form} onChange={(e) => setItem(i, { form: e.target.value })}>
                    {['Tablet', 'Capsule', 'Syrup', 'Injection', 'Gel', 'Mouthwash', 'Cream', 'Drops', 'Other'].map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Strength"><Input value={it.strength} onChange={(e) => setItem(i, { strength: e.target.value })} placeholder="500mg" /></Field>
                <Field label="Dose"><Input value={it.dose} onChange={(e) => setItem(i, { dose: e.target.value })} placeholder="1+0+1" /></Field>
                <div style={{ alignSelf: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon={<IconTrash size={14} />} disabled={items.length === 1} onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))} aria-label="Remove medicine" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={it.morning} onChange={(e) => setItem(i, { morning: e.target.checked })} /> Morning</label>
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={it.noon} onChange={(e) => setItem(i, { noon: e.target.checked })} /> Noon</label>
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={it.night} onChange={(e) => setItem(i, { night: e.target.checked })} /> Night</label>
                <span style={{ width: 1, height: 16, background: 'var(--dp-divider)' }} />
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={it.beforeFood} onChange={(e) => setItem(i, { beforeFood: e.target.checked })} /> Before food</label>
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={it.afterFood} onChange={(e) => setItem(i, { afterFood: e.target.checked })} /> After food</label>
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={it.prn} onChange={(e) => setItem(i, { prn: e.target.checked })} /> PRN (as needed)</label>
                <span style={{ width: 1, height: 16, background: 'var(--dp-divider)' }} />
                <Input style={{ width: 140 }} value={it.duration} onChange={(e) => setItem(i, { duration: e.target.value })} placeholder="Duration: 7 days" />
                <Input style={{ flex: 1, minWidth: 160 }} value={it.instructions} onChange={(e) => setItem(i, { instructions: e.target.value })} placeholder="Instructions (optional)" />
              </div>
            </div>
          ))}
        </div>
        <datalist id="medicine-catalog">
          {catalog.map((m) => (
            <option key={m.id} value={m.name}>{m.generic_name}</option>
          ))}
        </datalist>
        <Button variant="secondary" size="sm" icon={<IconPlus size={14} />} style={{ marginTop: 10 }} onClick={() => setItems((arr) => [...arr, emptyItem()])}>
          Add medicine
        </Button>
      </div>

      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

      {picking && (
        <PatientPicker
          title="Choose patient for prescription"
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

function PrescriptionView({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [rx, setRx] = useState<RxFull | null>(null);
  const [error, setError] = useState('');
  const [askVoid, setAskVoid] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const { toast } = useToast();

  const printRx = async () => {
    setPrinting(true);
    try {
      await api.printPrescription(id);
      toast('success', 'Sent to printer');
    } catch (e) {
      toast('error', 'Print failed', e instanceof Error ? e.message : undefined);
    } finally {
      setPrinting(false);
    }
  };

  const pdfRx = async () => {
    setSavingPdf(true);
    try {
      const saved = await api.pdfPrescription(id, `prescription-${rx?.rx_no ?? id}.pdf`);
      if (saved) toast('success', 'PDF saved', saved);
    } catch (e) {
      toast('error', 'PDF export failed', e instanceof Error ? e.message : undefined);
    } finally {
      setSavingPdf(false);
    }
  };

  useEffect(() => {
    api
      .rxGet(id)
      .then((r) => setRx(r as unknown as RxFull))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load prescription.'));
  }, [id]);

  const doseLine = (it: RxFull['items'][number]) => {
    if (it.prn) return 'If needed';
    return [it.morning ? 'M' : '', it.noon ? 'N' : '', it.night ? 'Nt' : ''].filter(Boolean).join('+') || '—';
  };

  return (
    <Modal
      title={rx ? `Prescription ${rx.rx_no}` : 'Prescription'}
      size="lg"
      onClose={onClose}
      footer={
        rx ? (
          <>
            <Button variant="secondary" icon={<IconPrinter size={14} />} loading={printing} onClick={() => void printRx()}>Print</Button>
            <Button variant="secondary" loading={savingPdf} onClick={() => void pdfRx()}>Save PDF</Button>
            {rx.status === 'active' && <Button variant="danger-outline" onClick={() => setAskVoid(true)}>Void prescription</Button>}
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </>
        ) : undefined
      }
    >
      {!rx ? (
        error ? <ErrorState message={error} /> : <LoadingRows rows={6} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <div className="dp-sub">Patient</div>
              <div style={{ fontWeight: 600 }}>{rx.patient_name} <span className="dp-sub">({rx.patient_code})</span></div>
            </div>
            <div>
              <div className="dp-sub">Age / Gender</div>
              <div>{rx.age ?? '—'} {rx.gender ? `/ ${rx.gender}` : ''}</div>
            </div>
            <div>
              <div className="dp-sub">Issued</div>
              <div>{new Date(rx.created_at).toLocaleString('en-GB')}</div>
            </div>
            <div>
              <div className="dp-sub">Dentist</div>
              <div>{rx.dentist_name ?? '—'}</div>
            </div>
          </div>

          {(rx.chief_complaint || rx.on_examination || rx.advice) && (
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              {rx.chief_complaint && <div style={{ marginBottom: 4 }}><span className="dp-sub">C/C: </span>{rx.chief_complaint}</div>}
              {rx.on_examination && <div style={{ marginBottom: 4 }}><span className="dp-sub">O/E: </span>{rx.on_examination}</div>}
              {rx.advice && <div><span className="dp-sub">Advice: </span>{rx.advice}</div>}
            </div>
          )}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Dose</th>
                  <th>Timing</th>
                  <th>Duration</th>
                  <th>Instructions</th>
                </tr>
              </thead>
              <tbody>
                {rx.items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{it.medicine_name}</span>
                      {it.strength && <span className="dp-sub"> {it.strength}</span>}
                      <span className="dp-sub"> ({it.form})</span>
                    </td>
                    <td>{it.dose || '—'}</td>
                    <td>
                      {doseLine(it)}
                      {it.before_food ? <Badge tone="info">before food</Badge> : null}
                      {it.after_food ? <Badge tone="info">after food</Badge> : null}
                    </td>
                    <td>{it.duration || '—'}</td>
                    <td className="cell-sub">{it.instructions || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rx.status !== 'active' && (
            <div className="alert alert-warning" style={{ marginTop: 12 }}>This prescription has been voided and is shown for record only.</div>
          )}
        </>
      )}

      {askVoid && rx && (
        <ConfirmDialogLike
          onClose={() => setAskVoid(false)}
          onConfirm={async () => {
            try {
              await api.rxVoid(rx.id);
              toast('success', 'Prescription voided');
              setAskVoid(false);
              onChanged();
              onClose();
            } catch (e) {
              toast('error', 'Void failed', e instanceof Error ? e.message : undefined);
            }
          }}
        />
      )}
    </Modal>
  );
}

function ConfirmDialogLike({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Void this prescription?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Keep</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
          >
            Void prescription
          </Button>
        </>
      }
    >
      <div className="alert alert-error">
        The prescription is kept in records but marked void, so it cannot be dispensed or reprinted as active.
      </div>
    </Modal>
  );
}
