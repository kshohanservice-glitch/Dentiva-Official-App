import { useCallback, useEffect, useState } from 'react';
import { api, type AppState } from './lib/api';
import { ToastProvider } from './components/ui';
import { ActivationScreen } from './pages/ActivationScreen';
import { SetupWizard } from './pages/SetupWizard';
import { LoginScreen } from './pages/LoginScreen';
import { LockScreen } from './pages/LockScreen';
import { AppShell } from './shell/AppShell';

type BootPhase = 'loading' | 'activation' | 'setup' | 'login' | 'locked' | 'app' | 'error';

export default function App() {
  const [phase, setPhase] = useState<BootPhase>('loading');
  const [state, setState] = useState<AppState | null>(null);
  const [bootError, setBootError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const s = await api.appState();
      setState(s);
      setBootError('');
      if (!s.activated) setPhase('activation');
      else if (!s.setupCompleted) setPhase('setup');
      else if (!s.session) setPhase('login');
      else if (s.locked) setPhase('locked');
      else setPhase('app');
    } catch (e) {
      setBootError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const offLock = window.dentiva.on('app:locked', () => setPhase('locked'));
    const offSession = window.dentiva.on('app:session-changed', () => void refresh());
    return () => {
      offLock();
      offSession();
    };
  }, [refresh]);

  let body: React.ReactNode;
  switch (phase) {
    case 'loading':
      body = <BootSplash />;
      break;
    case 'error':
      body = <BootError message={bootError} onRetry={() => void refresh()} />;
      break;
    case 'activation':
      body = <ActivationScreen onDone={() => void refresh()} />;
      break;
    case 'setup':
      body = <SetupWizard onDone={() => void refresh()} />;
      break;
    case 'login':
      body = <LoginScreen onDone={() => void refresh()} />;
      break;
    case 'locked':
      body = <LockScreen onUnlock={() => void refresh()} onLogout={() => void api.logout().then(refresh)} />;
      break;
    case 'app':
      body = <AppShell state={state!} onSessionChanged={() => void refresh()} />;
      break;
  }

  return <ToastProvider>{body}</ToastProvider>;
}

function BootSplash() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: 'var(--dp-bg)' }}>
      <div className="skeleton" style={{ width: 64, height: 64, borderRadius: 16 }} />
      <div className="skeleton" style={{ width: 180, height: 14 }} />
      <div className="skeleton" style={{ width: 120, height: 10 }} />
    </div>
  );
}

function BootError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
      <h2 className="dp-h2">Dentiva Pro could not start</h2>
      <p className="dp-sub" style={{ maxWidth: 420 }}>{message}</p>
      <button className="btn btn-primary" onClick={onRetry}>Retry</button>
    </div>
  );
}
