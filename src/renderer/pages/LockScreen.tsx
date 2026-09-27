import { useState } from 'react';
import { api } from '../lib/api';
import { Button, Input } from '../components/ui';
import { IconLock, IconTooth, IconLogout } from '../components/Icons';

export function LockScreen({ onUnlock, onLogout }: { onUnlock: () => void; onLogout: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.unlock(password);
      onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: 'linear-gradient(160deg, #0c1a28 0%, #123047 100%)',
        color: '#fff',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #0891b2, #155e75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          <IconTooth size={30} strokeWidth={1.5} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Dentiva Pro is locked</div>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Enter your password to continue. Your work is preserved.</div>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 320 }}>
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError('');
          }}
          autoFocus
          aria-label="Password to unlock"
          style={{ height: 42, textAlign: 'center' }}
        />
        {error && <div style={{ color: '#fda4af', fontSize: 13, textAlign: 'center' }}>{error}</div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} icon={<IconLock size={15} />}>
          Unlock
        </Button>
        <button
          type="button"
          onClick={onLogout}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.55)',
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginTop: 4,
          }}
        >
          <IconLogout size={14} /> Sign out instead
        </button>
      </form>
    </div>
  );
}
