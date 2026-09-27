import { useCallback, useEffect, useState } from 'react';
import { api, type BackupRow } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingRows, useToast } from '../components/ui';
import { IconDatabase, IconPlus, IconDownload } from '../components/Icons';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupPage(_p: { ctx: NavCtx }) {
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [folder, setFolder] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<BackupRow | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, dir] = await Promise.all([api.backupList(), api.backupFolder()]);
      setRows(list);
      setFolder(dir);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load backups.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createNow = async () => {
    setCreating(true);
    try {
      const res = await api.backupCreate();
      toast('success', 'Backup created', `${res.filePath} (${fmtSize(res.sizeBytes)})`);
      void load();
    } catch (e) {
      toast('error', 'Backup failed', e instanceof Error ? e.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Administration</div>
          <h1>Backup &amp; Restore</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>{folder || 'Backup folder not configured'}</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} loading={creating} onClick={() => void createNow()}>
            Create backup now
          </Button>
        </div>
      </div>

      <div className="alert alert-info" style={{ marginBottom: 16 }}>
        Backups are compressed archives of the live database, attachments and clinic branding. A restore always takes a
        safety backup first, verifies file integrity, and requires your <code>destructive.operations</code> permission.
        Automatic backups run at startup when due.
      </div>

      {loading ? (
        <div className="card"><LoadingRows rows={6} /></div>
      ) : error ? (
        <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconDatabase size={24} />}
            title="No backups yet"
            desc="Create your first backup, or wait for the automatic backup at next startup."
            action={<Button variant="primary" icon={<IconPlus size={15} />} loading={creating} onClick={() => void createNow()}>Create backup now</Button>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Kind</th>
                <th>Status</th>
                <th className="num">Size</th>
                <th>By</th>
                <th>File</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.created_at).toLocaleString('en-GB')}</td>
                  <td><Badge tone={b.kind === 'auto' ? 'info' : b.kind === 'manual' ? 'primary' : 'warning'}>{b.kind}</Badge></td>
                  <td><Badge tone={b.status === 'success' ? 'success' : 'error'}>{b.status}</Badge></td>
                  <td className="num">{fmtSize(b.size_bytes)}</td>
                  <td className="cell-sub">{b.created_by_name ?? '—'}</td>
                  <td className="dp-mono cell-sub" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.file_path}>
                    {b.file_path.split(/[\\/]/).pop()}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<IconDownload size={14} />}
                      disabled={!b.exists || b.status !== 'success'}
                      onClick={() => setRestoring(b)}
                    >
                      Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restoring && (
        <RestoreDialog
          backup={restoring}
          onClose={() => setRestoring(null)}
          onDone={() => {
            setRestoring(null);
            toast('success', 'Restore complete', 'The database has been replaced from the selected backup.');
            void load();
          }}
        />
      )}
    </div>
  );
}

function RestoreDialog({ backup, onClose, onDone }: { backup: BackupRow; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const fileName = backup.file_path.split(/[\\/]/).pop();

  return (
    <ConfirmDialog
      title="Restore from backup?"
      danger
      requireText="RESTORE"
      confirmLabel="Restore backup"
      message={
        `This replaces the current database and files with the contents of ${fileName} (${fmtSize(backup.size_bytes)}, created ${new Date(backup.created_at).toLocaleString('en-GB')}).\n\n` +
        `A fresh safety backup of the current state is taken automatically before anything is replaced. All users are affected immediately.`
      }
      onConfirm={async () => {
        try {
          // ConfirmDialog only enables this action once the operator has typed RESTORE.
          await api.backupRestore(backup.file_path, 'RESTORE');
          onDone();
        } catch (e) {
          toast('error', 'Restore failed', e instanceof Error ? e.message : undefined);
        }
      }}
      onClose={onClose}
    />
  );
}
