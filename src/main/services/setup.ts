/**
 * First-run setup wizard commit.
 * All-or-nothing: clinic info, dentists, first admin account, and preferences are
 * written in ONE transaction. An interrupted setup leaves no half-configured state.
 */
import { getDb, tx } from '../db/connection';
import { hashPassword, validatePasswordStrength } from './security';
import { ValidationError } from '../util/errors';
import { nowIso } from '../../shared/datetime';
import { setManySettings } from './settings';
import { audit } from './audit';
import { logger } from '../util/logger';

export interface SetupDentistInput {
  fullName: string;
  title?: string;
  designations?: string;
  registrationNo?: string;
  phone?: string;
  email?: string;
  consultationHours?: string;
  status?: 'active' | 'inactive';
}

export interface SetupInput {
  clinic: {
    name: string;
    address: string;
    phone: string;
    email?: string;
    website?: string;
    extraContact?: string;
    tagline?: string;
    businessHours?: string;
    workingDays: string[];
    holidays?: Array<{ date: string; name: string }>;
  };
  dentists: SetupDentistInput[];
  admin: {
    username: string;
    password: string;
    confirmPassword: string;
    displayName?: string;
  };
  preferences: {
    dateFormat?: string;
    timeFormat?: '12h' | '24h';
    autoLockMinutes?: number;
    autoBackupDays?: number;
    backupFolder?: string;
  };
}

export function isSetupCompleted(): boolean {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'setup_completed'").get<{ value: string }>();
  return row?.value === 'true';
}

const VALID_DAYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

export function validateSetup(input: SetupInput): string[] {
  const errors: string[] = [];
  const c = input.clinic;
  if (!c?.name?.trim()) errors.push('Clinic name is required.');
  if (!c?.phone?.trim()) errors.push('Clinic phone is required.');
  if (c?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errors.push('Clinic email is not valid.');
  if (!Array.isArray(c?.workingDays) || c.workingDays.length === 0) errors.push('Select at least one working day.');
  else if (!c.workingDays.every((d) => VALID_DAYS.has(d))) errors.push('Working days contain invalid values.');
  for (const h of c?.holidays ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) errors.push('Holiday date must be YYYY-MM-DD.');
  }

  if (!Array.isArray(input.dentists) || input.dentists.length === 0) {
    errors.push('At least one dentist is required.');
  } else {
    input.dentists.forEach((d, i) => {
      if (!d.fullName?.trim()) errors.push(`Dentist #${i + 1}: full name is required.`);
      if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.push(`Dentist #${i + 1}: email is not valid.`);
    });
  }

  const a = input.admin;
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(a?.username ?? '')) {
    errors.push('Admin username must be 3–32 characters (letters, numbers, dot, dash, underscore).');
  }
  const pwErr = validatePasswordStrength(a?.password ?? '');
  if (pwErr) errors.push(pwErr);
  if (a?.password !== a?.confirmPassword) errors.push('Passwords do not match.');
  if ((a?.password ?? '').toLowerCase() === (a?.username ?? '').toLowerCase() && a?.password) {
    errors.push('Password must not be the same as the username.');
  }

  const lock = input.preferences?.autoLockMinutes;
  if (lock !== undefined && ![0, 5, 10, 15, 30].includes(lock)) errors.push('Auto-lock must be 5, 10, 15 or 30 minutes (or disabled).');
  return errors;
}

export function completeSetup(input: SetupInput): void {
  if (isSetupCompleted()) {
    throw new ValidationError('Setup has already been completed.');
  }
  const errors = validateSetup(input);
  if (errors.length) throw new ValidationError(errors.join(' '));

  const db = getDb();
  const existingUser = db.prepare('SELECT COUNT(*) AS c FROM users').get<{ c: number }>()?.c ?? 0;
  if (existingUser > 0) throw new ValidationError('A user account already exists; setup cannot run again.');

  const at = nowIso();
  tx(() => {
    // Clinic
    db.prepare(
      `UPDATE clinic SET name = ?, address = ?, phone = ?, email = ?, website = ?, extra_contact = ?,
       tagline = ?, business_hours = ?, working_days = ?, updated_at = ? WHERE id = 1`,
    ).run(
      input.clinic.name.trim(),
      input.clinic.address?.trim() ?? '',
      input.clinic.phone.trim(),
      input.clinic.email?.trim() ?? '',
      input.clinic.website?.trim() ?? '',
      input.clinic.extraContact?.trim() ?? '',
      input.clinic.tagline?.trim() ?? '',
      input.clinic.businessHours?.trim() ?? '',
      input.clinic.workingDays.join(','),
      at,
    );

    for (const h of input.clinic.holidays ?? []) {
      db.prepare('INSERT OR IGNORE INTO holidays (holiday_date, name, created_at) VALUES (?, ?, ?)').run(h.date, h.name?.trim() ?? 'Holiday', at);
    }

    // Dentists
    const insDentist = db.prepare(
      `INSERT INTO dentists (full_name, title, designations, registration_no, phone, email, consultation_hours, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.dentists.forEach((d, i) => {
      insDentist.run(
        d.fullName.trim(),
        d.title?.trim() ?? '',
        d.designations?.trim() ?? '',
        d.registrationNo?.trim() ?? '',
        d.phone?.trim() ?? '',
        d.email?.trim() ?? '',
        d.consultationHours?.trim() ?? '',
        d.status ?? 'active',
        i,
        at,
        at,
      );
    });

    // Admin user + role
    const { hash, salt } = hashPassword(input.admin.password);
    const res = db
      .prepare(
        'INSERT INTO users (username, password_hash, salt, display_name, is_active, is_locked, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, ?, ?)',
      )
      .run(input.admin.username.trim(), hash, salt, input.admin.displayName?.trim() || input.admin.username.trim(), at, at);
    const adminRole = db.prepare('SELECT id FROM roles WHERE name = ?').get<{ id: number }>('Admin');
    if (!adminRole) throw new Error('Admin role missing — database seed incomplete.');
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(res.lastInsertRowid, adminRole.id);

    // Preferences
    setManySettings({
      date_format: input.preferences.dateFormat ?? 'DD/MM/YYYY',
      time_format: input.preferences.timeFormat ?? '12h',
      auto_lock_minutes: String(input.preferences.autoLockMinutes ?? 10),
      auto_backup_days: String(input.preferences.autoBackupDays ?? 7),
      backup_folder: input.preferences.backupFolder ?? '',
      setup_completed: 'true',
    });

    audit({ action: 'setup.completed', entity: 'clinic', entityId: 1 });
  });
  logger.info('setup.completed', { dentists: input.dentists.length });
}

/** Read everything the About/setup screens need. */
export function setupStatus() {
  return {
    setupCompleted: isSetupCompleted(),
    hasUsers: (getDb().prepare('SELECT COUNT(*) AS c FROM users').get<{ c: number }>()?.c ?? 0) > 0,
  };
}

/** Update clinic info after setup (requires settings.manage). */
export function updateClinicInfo(patch: {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  extraContact?: string;
  tagline?: string;
  businessHours?: string;
  workingDays?: string[];
}): void {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM clinic WHERE id = 1').get<Record<string, unknown>>();
  if (!cur) throw new Error('Clinic row missing');
  if (patch.workingDays && !patch.workingDays.every((d) => VALID_DAYS.has(d))) {
    throw new ValidationError('Working days contain invalid values.');
  }
  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
    throw new ValidationError('Email is not valid.');
  }
  db.prepare(
    `UPDATE clinic SET name = ?, address = ?, phone = ?, email = ?, website = ?, extra_contact = ?,
     tagline = ?, business_hours = ?, working_days = ?, updated_at = ? WHERE id = 1`,
  ).run(
    patch.name ?? String(cur.name),
    patch.address ?? String(cur.address),
    patch.phone ?? String(cur.phone),
    patch.email ?? String(cur.email),
    patch.website ?? String(cur.website),
    patch.extraContact ?? String(cur.extra_contact),
    patch.tagline ?? String(cur.tagline),
    patch.businessHours ?? String(cur.business_hours),
    patch.workingDays ? patch.workingDays.join(',') : String(cur.working_days),
    nowIso(),
  );
  audit({ action: 'clinic.updated', entity: 'clinic', entityId: 1 });
}

export function getClinic() {
  const row = getDb().prepare('SELECT * FROM clinic WHERE id = 1').get<Record<string, string | number | null>>();
  if (!row) return null;
  return {
    id: 1,
    name: String(row.name ?? ''),
    logoPath: (row.logo_path as string | null) ?? null,
    address: String(row.address ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    website: String(row.website ?? ''),
    extraContact: String(row.extra_contact ?? ''),
    tagline: String(row.tagline ?? ''),
    businessHours: String(row.business_hours ?? ''),
    workingDays: String(row.working_days ?? '').split(',').filter(Boolean),
  };
}
