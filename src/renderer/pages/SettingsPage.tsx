import { useCallback, useEffect, useState } from 'react';
import { api, type Clinic } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Button, Field, Input, Select, Textarea, useToast } from '../components/ui';

const TABS = [
  { id: 'clinic', label: 'Clinic' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'security', label: 'Security' },
  { id: 'account', label: 'My Account' },
  { id: 'financial', label: 'Financial defaults' },
];

export function SettingsPage({ ctx, initialTab }: { ctx: NavCtx; initialTab?: string }) {
  const [tab, setTab] = useState(initialTab && TABS.some((t) => t.id === initialTab) ? initialTab : 'clinic');
  void ctx;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Administration</div>
          <h1>Settings</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>Clinic configuration, preferences and security</div>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16, maxWidth: 860 }}>
        {tab === 'clinic' && <ClinicTab />}
        {tab === 'preferences' && <PreferencesTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'account' && <AccountTab />}
        {tab === 'financial' && <FinancialTab />}
      </div>
    </div>
  );
}

function ClinicTab() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => {
    void api.clinicGet().then(setClinic).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  if (!clinic) return <div className="skeleton" style={{ height: 300 }} />;

  const save = async () => {
    setBusy(true);
    try {
      await api.clinicUpdate(clinic);
      toast('success', 'Clinic information saved');
    } catch (e) {
      toast('error', 'Save failed', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof Clinic) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setClinic((cur) => (cur ? { ...cur, [k]: e.target.value } : cur));

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="form-grid">
        <Field label="Clinic name" required>
          <Input value={clinic.name} onChange={set('name')} />
        </Field>
        <Field label="Phone" required>
          <Input value={clinic.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <Input value={clinic.email} onChange={set('email')} />
        </Field>
        <Field label="Website">
          <Input value={clinic.website} onChange={set('website')} />
        </Field>
        <Field label="Address" className="span-2">
          <Textarea rows={2} value={clinic.address} onChange={set('address')} />
        </Field>
        <Field label="Business hours (display)">
          <Input value={clinic.businessHours} onChange={set('businessHours')} />
        </Field>
        <Field label="Tagline (prescription header/footer)">
          <Input value={clinic.tagline} onChange={set('tagline')} />
        </Field>
        <Field label="Additional contact info" className="span-2">
          <Input value={clinic.extraContact} onChange={set('extraContact')} />
        </Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" loading={busy} onClick={() => void save()}>Save clinic information</Button>
      </div>
    </div>
  );
}

function PreferencesTab() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => {
    void api.settingsAll().then(setSettings).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  if (!settings) return <div className="skeleton" style={{ height: 300 }} />;

  const save = async () => {
    setBusy(true);
    try {
      await Promise.all(
        ['date_format', 'time_format', 'auto_lock_minutes', 'auto_backup_days', 'backup_retention', 'expiry_warning_days', 'prescription_footer_message', 'theme', 'animations'].map((k) =>
          api.settingSet(k, settings[k] ?? ''),
        ),
      );
      toast('success', 'Preferences saved');
    } catch (e) {
      toast('error', 'Save failed', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setSettings((cur) => ({ ...(cur ?? {}), [k]: e.target.value }));

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="form-section-title">Regional</div>
      <div className="form-grid">
        <Field label="Currency">
          <Input value="BDT — Bangladeshi Taka (৳)" disabled />
        </Field>
        <Field label="Date format">
          <Select value={settings.date_format} onChange={set('date_format')}>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </Select>
        </Field>
        <Field label="Time format">
          <Select value={settings.time_format} onChange={set('time_format')}>
            <option value="12h">12-hour</option>
            <option value="24h">24-hour</option>
          </Select>
        </Field>
      </div>
      <div className="form-section-title">Appearance</div>
      <div className="form-grid">
        <Field label="Theme" hint="Light is the validated premium theme for this release.">
          <Select value={settings.theme} onChange={set('theme')}>
            <option value="light">Light</option>
          </Select>
        </Field>
        <Field label="Animations">
          <Select value={settings.animations} onChange={set('animations')}>
            <option value="on">On (subtle)</option>
            <option value="off">Off (reduced motion)</option>
          </Select>
        </Field>
      </div>
      <div className="form-section-title">Backup & safety</div>
      <div className="form-grid">
        <Field label="Auto-lock after inactivity">
          <Select value={settings.auto_lock_minutes} onChange={set('auto_lock_minutes')}>
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="0">Disabled</option>
          </Select>
        </Field>
        <Field label="Automatic backup frequency">
          <Select value={settings.auto_backup_days} onChange={set('auto_backup_days')}>
            <option value="7">Every 7 days</option>
            <option value="15">Every 15 days</option>
            <option value="30">Every 30 days</option>
            <option value="0">Disabled</option>
          </Select>
        </Field>
        <Field label="Backup retention (number of backups kept)">
          <Input value={settings.backup_retention} onChange={set('backup_retention')} inputMode="numeric" />
        </Field>
        <Field label="Inventory expiry warning (days ahead)">
          <Input value={settings.expiry_warning_days} onChange={set('expiry_warning_days')} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Prescription footer message">
        <Textarea rows={2} value={settings.prescription_footer_message} onChange={set('prescription_footer_message')} />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" loading={busy} onClick={() => void save()}>Save preferences</Button>
      </div>
    </div>
  );
}

function SecurityTab() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const { toast } = useToast();
  const load = useCallback(() => void api.settingsAll().then(setSettings).catch(() => undefined), []);
  useEffect(load, [load]);
  if (!settings) return <div className="skeleton" style={{ height: 200 }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card card-pad">
        <span className="card-title">Session & locking</span>
        <div className="dp-sub" style={{ marginTop: 6 }}>
          Auto-lock is enforced by the application core — the screen locks after inactivity and your password is required to
          continue. Current setting: {settings.auto_lock_minutes === '0' ? 'disabled' : `${settings.auto_lock_minutes} minutes`}.
          Change it under Preferences.
        </div>
      </div>
      <div className="card card-pad">
        <span className="card-title">Password policy</span>
        <ul className="dp-sub" style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Passwords are stored using the scrypt key-derivation function with a unique salt per user.</li>
          <li>Minimum length: 6 characters; password cannot equal the username.</li>
          <li>5 consecutive failed sign-ins temporarily lock the account for 5 minutes.</li>
          <li>All sign-ins and lock events are written to the audit log.</li>
        </ul>
      </div>
      <div className="alert alert-info">
        Financial and destructive permissions are enforced at the application service layer, not just hidden in the interface.
        Role configuration lives in <button className="muted-link" onClick={() => toast('info', 'Staff & Users', 'Open Administration → Staff & Users to manage roles and permissions.')}>Staff & Users</button>.
      </div>
    </div>
  );
}

function AccountTab() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const submit = async () => {
    setError('');
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      toast('success', 'Password changed', 'Use your new password the next time you sign in or unlock.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Change failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad" style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span className="card-title">Change my password</span>
      {error && <div className="alert alert-error">{error}</div>}
      <Field label="Current password" required>
        <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label="New password" required hint="At least 6 characters.">
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" required>
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </Field>
      <div>
        <Button variant="primary" loading={busy} onClick={() => void submit()}>Update password</Button>
      </div>
    </div>
  );
}

function FinancialTab() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const load = useCallback(() => void api.settingsAll().then(setSettings).catch(() => undefined), []);
  useEffect(load, [load]);

  if (!settings) return <div className="skeleton" style={{ height: 200 }} />;

  const save = async () => {
    setBusy(true);
    try {
      await Promise.all(['invoice_prefix', 'receipt_prefix', 'rx_prefix', 'patient_code_prefix'].map((k) => api.settingSet(k, settings[k] ?? '')));
      toast('success', 'Financial defaults saved', 'New documents will use these prefixes.');
    } catch (e) {
      toast('error', 'Save failed', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setSettings((cur) => ({ ...(cur ?? {}), [k]: e.target.value }));

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="alert alert-warning">
        Prefix changes affect newly created documents only. Existing invoices, receipts and prescriptions keep their numbers.
      </div>
      <div className="form-grid">
        <Field label="Invoice prefix"><Input value={settings.invoice_prefix} onChange={set('invoice_prefix')} className="dp-mono" /></Field>
        <Field label="Receipt prefix"><Input value={settings.receipt_prefix} onChange={set('receipt_prefix')} className="dp-mono" /></Field>
        <Field label="Prescription prefix"><Input value={settings.rx_prefix} onChange={set('rx_prefix')} className="dp-mono" /></Field>
        <Field label="Patient code prefix"><Input value={settings.patient_code_prefix} onChange={set('patient_code_prefix')} className="dp-mono" /></Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" loading={busy} onClick={() => void save()}>Save defaults</Button>
      </div>
    </div>
  );
}
