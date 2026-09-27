import { useState } from 'react';
import { api } from '../lib/api';
import { AuthFrame } from './auth-frame';
import { Button, Field, Input, useToast } from '../components/ui';
import { IconKey, IconCheck } from '../components/Icons';

export function ActivationScreen({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Please enter your activation code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.activate(code);
      toast('success', 'Activation complete', 'Dentiva Pro is now activated on this computer.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--dp-primary-700)' }}>
        <IconKey size={20} />
        <h2 className="dp-h2">Activate Dentiva Pro</h2>
      </div>
      <p className="dp-sub">
        Enter the one-time activation code provided with your purchase. Activation is performed locally — no internet
        connection is required.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Activation code" required error={error}>
          <Input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/[^\d]/g, ''));
              setError('');
            }}
            placeholder="Enter your activation code"
            autoFocus
            invalid={!!error}
            autoComplete="off"
            spellCheck={false}
            inputMode="numeric"
            style={{ fontFamily: 'var(--dp-mono)', letterSpacing: '0.12em' }}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} icon={busy ? undefined : <IconCheck size={16} />}>
          Activate
        </Button>
      </form>
    </AuthFrame>
  );
}
