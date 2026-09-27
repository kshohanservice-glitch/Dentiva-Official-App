import { useCallback, useEffect, useState } from 'react';
import { api, type NotificationRow } from '../lib/api';
import { Button, EmptyState, ErrorState, LoadingRows } from './ui';
import { IconBell, IconX, IconRefresh } from './Icons';

const SEV_TONE: Record<string, string> = {
  critical: 'var(--dp-error)',
  warning: 'var(--dp-warning)',
  success: 'var(--dp-success)',
  info: 'var(--dp-info)',
};

/** Slide-in notification center fed by the real alerts service. */
export function NotificationCenter({ onClose, onUnreadChanged }: { onClose: () => void; onUnreadChanged: (n: number) => void }) {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await api.notificationsList(false));
      onUnreadChanged(await api.notificationsUnread());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications.');
    }
  }, [onUnreadChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshAlerts = async () => {
    setRefreshing(true);
    try {
      await api.notificationsRefresh();
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const open = async (n: NotificationRow) => {
    try {
      if (!n.is_read) {
        await api.notificationRead(n.id);
        setRows((rs) => rs?.map((r) => (r.id === n.id ? { ...r, is_read: 1 } : r)) ?? null);
        onUnreadChanged(await api.notificationsUnread());
      }
    } catch {
      /* read-marking failure is non-fatal */
    }
    if (n.link.startsWith('page:')) {
      onClose();
      window.dispatchEvent(new CustomEvent('dp:navigate', { detail: n.link.slice('page:'.length) }));
    }
  };

  return (
    <div className="notif-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="notif-panel" role="dialog" aria-label="Notifications">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--dp-divider)' }}>
          <IconBell size={17} />
          <strong style={{ flex: 1 }}>Notifications</strong>
          <Button size="sm" variant="ghost" icon={<IconRefresh size={14} />} loading={refreshing} onClick={() => void refreshAlerts()}>
            Refresh alerts
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void api.notificationsReadAll().then(() => load())}>
            Mark all read
          </Button>
          <button className="topbar-icon-btn" aria-label="Close notifications" onClick={onClose}>
            <IconX size={15} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : rows === null ? (
            <LoadingRows rows={5} />
          ) : rows.length === 0 ? (
            <EmptyState icon={<IconBell size={22} />} title="All clear" desc="No notifications. Alerts for low stock, expiries, dues and appointments appear here." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {rows.map((n) => (
                <button
                  key={n.id}
                  onClick={() => void open(n)}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--dp-divider)',
                    background: n.is_read ? 'transparent' : 'var(--dp-surface-2)',
                    border: 'none',
                    borderLeft: `3px solid ${SEV_TONE[n.severity] ?? 'var(--dp-divider)'}`,
                    textAlign: 'left',
                    cursor: n.link ? 'pointer' : 'default',
                    width: '100%',
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: n.is_read ? 500 : 700, fontSize: 13, display: 'block' }}>
                      {n.title}
                      {!n.is_read && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: 'var(--dp-primary)', marginLeft: 7 }} />}
                    </span>
                    {n.body && <span className="dp-sub" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>{n.body}</span>}
                    <span className="dp-sub" style={{ fontSize: 11 }}>{new Date(n.created_at).toLocaleString('en-GB')}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
