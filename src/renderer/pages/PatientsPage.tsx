import { useCallback, useEffect, useState } from 'react';
import { api, type PatientRow } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Pagination, SearchInput, Select, Textarea, useToast, Badge } from '../components/ui';
import { IconPlus, IconUsers, IconPin, IconEdit } from '../components/Icons';

const PRESETS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: '1y', label: 'Last year' },
] as const;

export function PatientsPage({ ctx }: { ctx: NavCtx }) {
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<string>('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; row: PatientRow } | null>(null);
  const pageSize = 25;
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.patientsList({ search, preset, status, page, pageSize });
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load patients.');
    } finally {
      setLoading(false);
    }
  }, [search, preset, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Practice</div>
          <h1>Patients</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>{total} patient records · newest first</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setEditor({ mode: 'create' })}>
            New Patient
          </Button>
        </div>
      </div>

      <div className="toolbar">
        <SearchInput placeholder="Search by name, code, phone, address…" onSearch={(v) => { setSearch(v); setPage(1); }} />
        <div className="segmented" role="tablist" aria-label="Date filter">
          {PRESETS.map((p) => (
            <button key={p.id} className={preset === p.id ? 'active' : ''} onClick={() => { setPreset(p.id); setPage(1); }}>
              {p.label}
            </button>
          ))}
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 140 }} aria-label="Status filter">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={8} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconUsers size={24} />}
            title={search || preset !== 'all' || status !== 'all' ? 'No patients match your filters' : 'No patients yet'}
            desc={search || preset !== 'all' || status !== 'all' ? 'Try adjusting the search or filters.' : 'Create your first patient record to begin.'}
            action={!search && preset === 'all' && status === 'all' ? <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setEditor({ mode: 'create' })}>New Patient</Button> : undefined}
          />
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Age / Gender</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Registered</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => ctx.navigate(`patient:${p.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="topbar-icon-btn"
                        style={{ width: 28, height: 28 }}
                        title={p.is_pinned ? 'Unpin patient' : 'Pin patient'}
                        aria-label={p.is_pinned ? 'Unpin patient' : 'Pin patient'}
                        onClick={() => void api.patientSetPinned(p.id, !p.is_pinned).then(load)}
                      >
                        <IconPin size={14} className={p.is_pinned ? '' : 'dp-muted'} />
                      </button>
                    </td>
                    <td className="dp-mono">{p.patient_code}</td>
                    <td className="cell-main">{p.full_name}</td>
                    <td>
                      {p.age !== null ? `${p.age} yrs` : '—'}
                      {p.gender ? ` · ${p.gender[0].toUpperCase()}${p.gender.slice(1)}` : ''}
                    </td>
                    <td>{p.phone || '—'}</td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.address || '—'}</td>
                    <td>
                      {p.status === 'active' ? <Badge tone="success">Active</Badge> : p.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : <Badge tone="warning">Inactive</Badge>}
                    </td>
                    <td className="cell-sub">{new Date(p.created_at).toLocaleDateString('en-GB')}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="secondary" icon={<IconEdit size={13} />} onClick={() => setEditor({ mode: 'edit', row: p })}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}

      {editor && (
        <PatientEditor
          existing={editor.mode === 'edit' ? editor.row : null}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setEditor(null);
            void load();
            if (editor.mode === 'create') {
              toast('success', 'Patient created', 'The patient record has been saved.');
              if (id) ctx.navigate(`patient:${id}`);
            } else {
              toast('success', 'Patient updated');
            }
          }}
        />
      )}
    </div>
  );
}

export function PatientEditor({ existing, onClose, onSaved }: { existing: PatientRow | null; onClose: () => void; onSaved: (id?: number) => void }) {
  const [f, setF] = useState({
    fullName: existing?.full_name ?? '',
    patientCode: '',
    age: existing?.age?.toString() ?? '',
    gender: existing?.gender ?? '',
    bloodGroup: existing?.blood_group ?? '',
    address: existing?.address ?? '',
    phone: existing?.phone ?? '',
    emergencyPhone: existing?.emergency_phone ?? '',
    presentComplaint: existing?.present_complaint ?? '',
    pastHistory: '',
    notes: '',
    identifier: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (existing) {
      // Load full record for editing to preserve history fields.
      void api.patientGet(existing.id).then((full) => {
        setF((cur) => ({
          ...cur,
          pastHistory: (full as unknown as { past_history?: string }).past_history ?? '',
          notes: (full as unknown as { notes?: string }).notes ?? '',
          identifier: (full as unknown as { identifier?: string }).identifier ?? '',
        }));
      }).catch(() => undefined);
    }
  }, [existing]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = {
        fullName: f.fullName,
        patientCode: f.patientCode || undefined,
        age: f.age === '' ? null : Number(f.age),
        gender: f.gender,
        bloodGroup: f.bloodGroup,
        address: f.address,
        phone: f.phone,
        emergencyPhone: f.emergencyPhone,
        presentComplaint: f.presentComplaint,
        pastHistory: f.pastHistory,
        notes: f.notes,
        identifier: f.identifier,
      };
      if (existing) {
        await api.patientUpdate(existing.id, payload);
        onSaved(existing.id);
      } else {
        const res = await api.patientCreate(payload);
        onSaved(res.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? `Edit patient — ${existing.patient_code}` : 'New patient'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {existing ? 'Save changes' : 'Create patient'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-grid">
          <Field label="Full name" required>
            <Input value={f.fullName} onChange={set('fullName')} autoFocus placeholder="Patient full name (English or Bengali)" />
          </Field>
          <Field label="Patient code" hint={existing ? 'Changing the code must keep it unique.' : 'Leave blank to auto-generate.'}>
            <Input value={f.patientCode} onChange={set('patientCode')} placeholder="Auto" className="dp-mono" />
          </Field>
          <Field label="Age">
            <Input value={f.age} onChange={set('age')} inputMode="numeric" placeholder="e.g. 34" />
          </Field>
          <Field label="Gender">
            <Select value={f.gender} onChange={set('gender')}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Blood group">
            <Select value={f.bloodGroup} onChange={set('bloodGroup')}>
              <option value="">—</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </Select>
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={set('phone')} placeholder="+880…" />
          </Field>
          <Field label="Emergency phone">
            <Input value={f.emergencyPhone} onChange={set('emergencyPhone')} />
          </Field>
          <Field label="Other identifier (NID, etc.)">
            <Input value={f.identifier} onChange={set('identifier')} />
          </Field>
          <Field label="Address" className="span-2">
            <Textarea rows={2} value={f.address} onChange={set('address')} />
          </Field>
          <Field label="Present complaint / problem" className="span-2">
            <Textarea rows={2} value={f.presentComplaint} onChange={set('presentComplaint')} placeholder="e.g. Tooth pain, lower right, 3 days" />
          </Field>
          <Field label="Past medical / dental history" className="span-2">
            <Textarea rows={2} value={f.pastHistory} onChange={set('pastHistory')} />
          </Field>
          <Field label="Additional notes" className="span-2">
            <Textarea rows={2} value={f.notes} onChange={set('notes')} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
