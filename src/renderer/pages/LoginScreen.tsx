import { useState } from 'react';
import { api } from '../lib/api';
import { AuthFrame } from './auth-frame';
import { Button, Field, Input } from '../components/ui';
import { IconLock } from '../components/Icons';

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.login(username, password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--dp-primary-700)' }}>
        <IconLock size={20} />
        <h2 className="dp-h2">Sign in</h2>
      </div>
      <p className="dp-sub">Sign in with your Dentiva Pro account to continue.</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Username" required>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" spellCheck={false} />
        </Field>
        <Field label="Password" required error={error}>
          <Input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError('');
            }}
            autoComplete="current-password"
            invalid={!!error}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthFrame>
  );
}
