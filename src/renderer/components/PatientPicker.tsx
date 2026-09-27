import { useCallback, useEffect, useState } from 'react';
import { api, type PatientRow } from '../lib/api';
import { Button, EmptyState, ErrorState, LoadingRows, Modal, SearchInput } from './ui';

/** Modal that searches real patient records and lets the caller pick one. */
export function PatientPicker({
  title = 'Select patient',
  onPick,
  onClose,
}: {
  title?: string;
  onPick: (p: PatientRow) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.patientsList({ search, preset: 'all', status: 'all', page: 1, pageSize: 12 });
      setRows(res.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to search patients.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal title={title} onClose={onClose} size="md">
      <SearchInput autoFocus placeholder="Search patients by name, code or phone…" onSearch={setSearch} />
      <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto' }}>
        {loading ? (
          <LoadingRows rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No matching patients" desc="Try a different search, or register the patient first from the Patients page." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((p) => (
              <button
                key={p.id}
                className="picker-row"
                onClick={() => onPick(p)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  background: 'var(--dp-surface-2)',
                  border: '1px solid var(--dp-divider)',
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span className="avatar" style={{ flex: 'none' }}>{p.full_name.slice(0, 1).toUpperCase()}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{p.full_name}</span>
                  <span className="dp-sub" style={{ marginLeft: 8 }}>{p.patient_code}{p.phone ? ` · ${p.phone}` : ''}</span>
                </span>
                <Button size="sm" variant="secondary">Select</Button>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
