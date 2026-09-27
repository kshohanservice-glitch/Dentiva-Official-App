import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { AuthFrame } from './auth-frame';
import { Button, Field, Input, Select, Textarea, useToast, ConfirmDialog } from '../components/ui';
import { IconCheck, IconChevronLeft, IconPlus, IconTrash, IconTooth } from '../components/Icons';

interface DentistDraft {
  fullName: string;
  title: string;
  designations: string;
  registrationNo: string;
  phone: string;
  email: string;
  consultationHours: string;
}

const DAY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
];

const emptyDentist = (): DentistDraft => ({
  fullName: '',
  title: '',
  designations: '',
  registrationNo: '',
  phone: '',
  email: '',
  consultationHours: '',
});

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  const { toast } = useToast();

  // clinic
  const [clinicName, setClinicName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [businessHours, setBusinessHours] = useState('');
  const [tagline, setTagline] = useState('');
  const [workingDays, setWorkingDays] = useState<string[]>(['sat', 'sun', 'mon', 'tue', 'wed', 'thu']);

  // dentists
  const [dentists, setDentists] = useState<DentistDraft[]>([emptyDentist()]);

  // admin
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  // preferences
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('12h');
  const [autoLock, setAutoLock] = useState('10');
  const [autoBackup, setAutoBackup] = useState('7');
  const [footerMessage, setFooterMessage] = useState('Wishing you a healthy smile — thank you for choosing us.');

  const [errors, setErrors] = useState<string[]>([]);

  const steps = ['Clinic Information', 'Dentists', 'Administrator Account', 'Preferences', 'Review & Finish'];

  const validateStep = (): string[] => {
    const errs: string[] = [];
    if (step === 0) {
      if (!clinicName.trim()) errs.push('Clinic name is required.');
      if (!phone.trim()) errs.push('Clinic phone number is required.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('Clinic email is not valid.');
      if (workingDays.length === 0) errs.push('Select at least one working day.');
    } else if (step === 1) {
      if (dentists.length === 0) errs.push('Add at least one dentist.');
      dentists.forEach((d, i) => {
        if (!d.fullName.trim()) errs.push(`Dentist ${i + 1}: full name is required.`);
        if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errs.push(`Dentist ${i + 1}: email is not valid.`);
      });
    } else if (step === 2) {
      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) errs.push('Admin username must be 3–32 characters (letters, numbers, dot, dash, underscore).');
      if (password.length < 6) errs.push('Password must be at least 6 characters.');
      if (password !== confirm) errs.push('Passwords do not match.');
      if (password && password.toLowerCase() === username.toLowerCase()) errs.push('Password must not be the same as the username.');
    }
    return errs;
  };

  const next = () => {
    const errs = validateStep();
    setErrors(errs);
    if (!errs.length) setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const finish = async () => {
    setBusy(true);
    setErrors([]);
    try {
      await api.setupComplete({
        clinic: {
          name: clinicName,
          address,
          phone,
          email,
          website,
          tagline,
          businessHours,
          workingDays,
        },
        dentists: dentists.map((d) => ({ ...d })),
        admin: { username, password, confirmPassword: confirm, displayName: username },
        preferences: {
          dateFormat,
          timeFormat,
          autoLockMinutes: Number(autoLock),
          autoBackupDays: Number(autoBackup),
        },
      });
      toast('success', 'Setup complete', 'Welcome to Dentiva Pro. Sign in with your new administrator account.');
      onDone();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Setup failed.']);
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(
    () => ({
      clinic: `${clinicName || '—'} · ${phone || 'no phone'}`,
      dentists: dentists.filter((d) => d.fullName.trim()).map((d) => d.fullName).join(', ') || '—',
      admin: username || '—',
      prefs: `${dateFormat}, ${timeFormat === '12h' ? '12-hour' : '24-hour'} time, auto-lock ${autoLock === '0' ? 'off' : `${autoLock} min`}, backup every ${autoBackup === '0' ? '—' : `${autoBackup} days`}`,
    }),
    [clinicName, phone, dentists, username, dateFormat, timeFormat, autoLock, autoBackup],
  );

  return (
    <AuthFrame wide>
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {steps.map((s, i) => (
          <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: i <= step ? 'var(--dp-primary-600)' : 'var(--dp-surface-sunken)',
              }}
            />
            <span style={{ fontSize: 11, color: i === step ? 'var(--dp-primary-700)' : 'var(--dp-text-faint)', fontWeight: i === step ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {i + 1}. {s}
            </span>
          </div>
        ))}
      </div>

      {errors.length > 0 && (
        <div className="alert alert-error" style={{ flexDirection: 'column', gap: 4 }}>
          {errors.map((e) => (
            <div key={e}>• {e}</div>
          ))}
        </div>
      )}

      {step === 0 && (
        <div className="form-grid">
          <Field label="Clinic / Dental Care name" required className="span-2">
            <Input value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="e.g. SmileCare Dental" autoFocus />
          </Field>
          <Field label="Phone" required>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+880 1XXX-XXXXXX" />
          </Field>
          <Field label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="clinic@example.com" />
          </Field>
          <Field label="Address" className="span-2">
            <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, Road, Area, City" />
          </Field>
          <Field label="Website (optional)">
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="www.example.com" />
          </Field>
          <Field label="Business hours (display text)">
            <Input value={businessHours} onChange={(e) => setBusinessHours(e.target.value)} placeholder="e.g. Sat–Thu, 10:00 AM – 8:00 PM" />
          </Field>
          <Field label="Weekly working days" className="span-2">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAY_OPTIONS.map((d) => {
                const on = workingDays.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setWorkingDays((cur) => (on ? cur.filter((x) => x !== d.key) : [...cur, d.key]))}
                    aria-pressed={on}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Tagline / footer message (shown on prescriptions)" className="span-2">
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Your smile, our care" />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="dp-sub">Add one or more dentists who will consult at this clinic.</p>
          {dentists.map((d, i) => (
            <div key={i} className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dp-strong" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <IconTooth size={16} /> Dentist {i + 1}
                </span>
                {dentists.length > 1 && (
                  <Button size="sm" variant="danger-outline" icon={<IconTrash size={14} />} onClick={() => setDentists((cur) => cur.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                )}
              </div>
              <div className="form-grid">
                <Field label="Full name" required>
                  <Input value={d.fullName} onChange={(e) => setDentists((cur) => cur.map((x, j) => (j === i ? { ...x, fullName: e.target.value } : x)))} placeholder="Dr. Full Name" />
                </Field>
                <Field label="Professional title / degree">
                  <Input value={d.title} onChange={(e) => setDentists((cur) => cur.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="BDS, MS (Orthodontics)" />
                </Field>
                <Field label="Designations (one per line)">
                  <Textarea rows={2} value={d.designations} onChange={(e) => setDentists((cur) => cur.map((x, j) => (j === i ? { ...x, designations: e.target.value } : x)))} placeholder={'Consultant, Dental Surgeon'} />
                </Field>
                <Field label="Registration / license no.">
                  <Input value={d.registrationNo} onChange={(e) => setDentists((cur) => cur.map((x, j) => (j === i ? { ...x, registrationNo: e.target.value } : x)))} placeholder="BMDC Reg. no." />
                </Field>
                <Field label="Phone">
                  <Input value={d.phone} onChange={(e) => setDentists((cur) => cur.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                </Field>
                <Field label="Email">
                  <Input value={d.email} onChange={(e) => setDentists((cur) => cur.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                </Field>
                <Field label="Consultation hours" className="span-2">
                  <Input value={d.consultationHours} onChange={(e) => setDentists((cur) => cur.map((x, j) => (j === i ? { ...x, consultationHours: e.target.value } : x)))} placeholder="e.g. 5:00 PM – 9:00 PM (Sat–Thu)" />
                </Field>
              </div>
            </div>
          ))}
          <Button variant="secondary" icon={<IconPlus size={15} />} onClick={() => setDentists((cur) => [...cur, emptyDentist()])} style={{ alignSelf: 'flex-start' }}>
            Add another dentist
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <p className="dp-sub">Create the administrator account. This account has full control of Dentiva Pro, including users, backups and settings.</p>
          <Field label="Username" required hint="3–32 characters: letters, numbers, dot, dash, underscore.">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Password" required hint="At least 6 characters.">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password" required>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="form-grid">
          <Field label="Currency">
            <Input value="BDT — Bangladeshi Taka (৳)" disabled />
          </Field>
          <Field label="Date format">
            <Select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </Select>
          </Field>
          <Field label="Time format">
            <Select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value as '12h' | '24h')}>
              <option value="12h">12-hour (2:30 PM)</option>
              <option value="24h">24-hour (14:30)</option>
            </Select>
          </Field>
          <Field label="Auto-lock after inactivity">
            <Select value={autoLock} onChange={(e) => setAutoLock(e.target.value)}>
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="0">Disabled</option>
            </Select>
          </Field>
          <Field label="Automatic backup frequency">
            <Select value={autoBackup} onChange={(e) => setAutoBackup(e.target.value)}>
              <option value="7">Every 7 days</option>
              <option value="15">Every 15 days</option>
              <option value="30">Every 30 days</option>
              <option value="0">Disabled</option>
            </Select>
          </Field>
          <Field label="Backup location" hint="Leave blank to use the default Backups folder. You can change this anytime in Settings → Backup.">
            <Input value="(Default) Dentiva Pro → Backups" disabled />
          </Field>
          <Field label="Default prescription footer message" className="span-2">
            <Textarea rows={2} value={footerMessage} onChange={(e) => setFooterMessage(e.target.value)} />
          </Field>
        </div>
      )}

      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="alert alert-info">
            Review your setup. You can go back to change anything. When you finish, the administrator account is created and you can sign in.
          </div>
          {[
            ['Clinic', summary.clinic],
            ['Dentists', summary.dentists],
            ['Administrator', summary.admin],
            ['Preferences', summary.prefs],
            ['Prescription footer', footerMessage || tagline || '—'],
          ].map(([k, v]) => (
            <div key={k} className="card card-pad" style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span className="dp-sub" style={{ flex: 'none', width: 140 }}>{k}</span>
              <span style={{ textAlign: 'right', fontSize: 13, overflowWrap: 'anywhere' }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Wizard controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <Button variant="ghost" onClick={() => setCancelAsk(true)}>
          Cancel
        </Button>
        <div style={{ display: 'flex', gap: 8 }}>
          {step > 0 && (
            <Button variant="secondary" icon={<IconChevronLeft size={15} />} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </Button>
          )}
          {step < steps.length - 1 ? (
            <Button variant="primary" onClick={next}>
              Next
            </Button>
          ) : (
            <Button variant="primary" loading={busy} onClick={() => void finish()} icon={busy ? undefined : <IconCheck size={15} />}>
              Finish setup
            </Button>
          )}
        </div>
      </div>

      {cancelAsk && (
        <ConfirmDialog
          title="Cancel setup?"
          message={'Nothing has been saved yet. If you cancel now, you will start again from the beginning next time you open Dentiva Pro.'}
          confirmLabel="Cancel setup"
          danger
          onConfirm={() => {
            setCancelAsk(false);
            setStep(0);
            toast('info', 'Setup cancelled', 'No data was saved.');
          }}
          onClose={() => setCancelAsk(false)}
        />
      )}
    </AuthFrame>
  );
}
