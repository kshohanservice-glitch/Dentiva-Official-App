import { useEffect, useRef, useState } from 'react';
import { api, type SearchHit } from '../lib/api';
import { EmptyState, LoadingRows } from './ui';
import { IconSearch, IconUsers, IconInvoice, IconPill, IconCalendar, IconBox, IconFileText } from './Icons';

const TYPE_META: Record<string, { icon: typeof IconUsers; label: string }> = {
  patient: { icon: IconUsers, label: 'Patient' },
  invoice: { icon: IconInvoice, label: 'Invoice' },
  prescription: { icon: IconPill, label: 'Prescription' },
  appointment: { icon: IconCalendar, label: 'Appointment' },
  inventory: { icon: IconBox, label: 'Inventory' },
  staff: { icon: IconFileText, label: 'Staff' },
  treatment: { icon: IconFileText, label: 'Treatment' },
};

/** Ctrl+K palette — searches patients, invoices, prescriptions and more, then navigates. */
export function GlobalSearchPalette({ navigate, onClose }: { navigate: (r: string) => void; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (term.trim().length < 2) {
      setHits([]);
      setCounts({});
      setDone(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => {
      api
        .searchGlobal(term.trim())
        .then((res) => {
          setHits(res.hits);
          setCounts(res.counts);
        })
        .catch(() => {
          setHits([]);
        })
        .finally(() => {
          setLoading(false);
          setDone(true);
        });
    }, 200);
    return () => clearTimeout(timer.current);
  }, [term]);

  const go = (h: SearchHit) => {
    // Search links are "patient:<id>" for records, or "page:<route>" for modules.
    if (h.link.startsWith('page:')) navigate(h.link.slice('page:'.length));
    else navigate(h.link);
    onClose();
  };

  const countLine = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
    .join(' · ');

  return (
    <div
      className="modal-overlay"
      style={{ alignItems: 'flex-start', paddingTop: '12vh' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width: 560, maxWidth: '92vw' }} role="dialog" aria-modal="true" aria-label="Global search">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--dp-divider)' }}>
          <IconSearch size={17} />
          <input
            className="input"
            style={{ border: 'none', boxShadow: 'none', padding: 0, fontSize: 15 }}
            placeholder="Search patients, invoices, prescriptions… (min 2 characters)"
            value={term}
            autoFocus
            onChange={(e) => setTerm(e.target.value)}
          />
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close search">Esc</button>
        </div>
        <div style={{ maxHeight: '52vh', overflowY: 'auto', padding: '8px 10px' }}>
          {loading ? (
            <LoadingRows rows={4} />
          ) : term.trim().length < 2 ? (
            <div className="dp-sub" style={{ padding: 18, textAlign: 'center' }}>
              Type at least 2 characters to search the whole practice.
            </div>
          ) : hits.length === 0 ? (
            <EmptyState title="No matches" desc={done ? `Nothing found for “${term}”.` : 'Searching…'} />
          ) : (
            <>
              {countLine && <div className="dp-sub" style={{ padding: '4px 8px 8px' }}>{countLine}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {hits.map((h) => {
                  const meta = TYPE_META[h.kind] ?? { icon: IconFileText, label: h.kind };
                  const Icon = meta.icon;
                  return (
                    <button
                      key={`${h.kind}:${h.id}`}
                      onClick={() => go(h)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '9px 10px',
                        borderRadius: 9,
                        background: 'transparent',
                        border: '1px solid transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dp-surface-2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ color: 'var(--dp-text-faint)', flex: 'none' }}><Icon size={17} /></span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5, display: 'block' }}>{h.title}</span>
                        {h.subtitle && <span className="dp-sub" style={{ fontSize: 12 }}>{h.subtitle}</span>}
                      </span>
                      <span className="badge badge-neutral" style={{ flex: 'none' }}>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
