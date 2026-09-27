import { useCallback, useEffect, useState } from 'react';
import { api, type TreatmentRow } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, SearchInput, useToast } from '../components/ui';
import { IconStethoscope, IconPlus, IconEdit } from '../components/Icons';
import { formatBDT, parseAmountToPaisa } from '../../shared/money';

export function TreatmentsPage(_p: { ctx: NavCtx }) {
  const [rows, setRows] = useState<TreatmentRow[]>([]);
  const [term, setTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; row: TreatmentRow } | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.treatmentsList(showInactive, term);
      setRows(res as unknown as TreatmentRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load treatments.');
    } finally {
      setLoading(false);
    }
  }, [showInactive, term]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Clinical</div>
          <h1>Treatments</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>{rows.length} procedures in the price list</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setEditor({ mode: 'create' })}>New treatment</Button>
        </div>
      </div>

      <div className="toolbar">
        <SearchInput placeholder="Search by name, code or category…" onSearch={setTerm} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          <span>Show retired</span>
        </label>
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={7} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconStethoscope size={24} />}
            title="No treatments defined"
            desc="Build your procedure catalogue. Treatments carry a default price used when billing."
            action={<Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setEditor({ mode: 'create' })}>New treatment</Button>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th className="num">Default price</th>
                  <th className="num">Duration</th>
                  <th>Status</th>
                  <th style={{ width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="dp-mono cell-main">{t.code}</td>
                    <td>{t.name}</td>
                    <td className="cell-sub">{t.category || '—'}</td>
                    <td className="num">{formatBDT(t.default_price_paisa)}</td>
                    <td className="num">{t.duration_minutes ? `${t.duration_minutes}m` : '—'}</td>
                    <td>{t.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Retired</Badge>}</td>
                  <td>
                    <Button size="sm" variant="ghost" icon={<IconEdit size={14} />} onClick={() => setEditor({ mode: 'edit', row: t })} aria-label="Edit treatment" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <TreatmentEditor
          existing={editor.mode === 'edit' ? editor.row : null}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            toast('success', editor.mode === 'create' ? 'Treatment created' : 'Treatment updated');
            void load();
          }}
        />
      )}
    </div>
  );
}

function TreatmentEditor({ existing, onClose, onSaved }: { existing: TreatmentRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [price, setPrice] = useState(existing ? (existing.default_price_paisa / 100).toFixed(2) : '');
  const [duration, setDuration] = useState(existing?.duration_minutes ? String(existing.duration_minutes) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isEdit = Boolean(existing);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const pricePaisa = price.trim() ? parseAmountToPaisa(price) : 0;
      if (pricePaisa === null || pricePaisa < 0) {
        setError('Default price must be a valid non-negative amount.');
        setBusy(false);
        return;
      }
      const payload = {
        name: name.trim(),
        code: code.trim(),
        category: category.trim() || undefined,
        defaultPricePaisa: pricePaisa,
        durationMinutes: duration ? Number(duration) : undefined,
      };
      if (isEdit && existing) {
        await api.treatmentUpdate(existing.id, payload);
      } else {
        await api.treatmentCreate(payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Edit — ${existing?.name}` : 'New treatment'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>{isEdit ? 'Save changes' : 'Create treatment'}</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Name" required className="field-full"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Code" required><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. RCT-01" /></Field>
        <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Endodontics" /></Field>
        <Field label="Default price (৳)" hint="Stored as integer paisa"><Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" /></Field>
        <Field label="Duration (minutes)"><Input type="number" min={5} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}
