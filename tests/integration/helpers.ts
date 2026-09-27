/**
 * Integration-test bootstrap: real SQLite (temp file), real services.
 * Runs on the node:sqlite fallback driver in CI sandboxes and better-sqlite3
 * in production builds — identical SQL either way.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, closeDatabase, getDb } from '../../src/main/db/connection';
import { completeSetup, type SetupInput } from '../../src/main/services/setup';
import { sessionManager } from '../../src/main/services/session';

export interface TestCtx {
  dir: string;
  cleanup: () => void;
}

export function freshDb(): TestCtx {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-test-'));
  initDatabase(path.join(dir, 'dentiva.db'));
  return {
    dir,
    cleanup: () => {
      if (sessionManager.hasSession()) {
        try {
          sessionManager.logout();
        } catch {
          /* ignore */
        }
      }
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const ADMIN_USER = 'admin';
export const ADMIN_PASSWORD = 'AdminPass!2026';

export function standardSetupInput(): SetupInput {
  return {
    clinic: {
      name: 'Test Dental Care',
      address: '12 Test Road, Dhaka',
      phone: '+8801700000000',
      email: 'clinic@example.com',
      tagline: 'Test tagline',
      businessHours: '10:00 AM – 8:00 PM',
      workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'],
      holidays: [{ date: '2026-12-16', name: 'Victory Day' }],
    },
    dentists: [
      {
        fullName: 'Dr. Ayesha Rahman',
        title: 'BDS',
        designations: 'Consultant',
        phone: '+8801800000000',
        consultationHours: '5 PM – 9 PM',
      },
    ],
    admin: {
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      confirmPassword: ADMIN_PASSWORD,
      displayName: 'Administrator',
    },
    preferences: {
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
      autoLockMinutes: 10,
      autoBackupDays: 7,
    },
  };
}

/** Complete setup and sign in as the admin created by the setup. */
export function bootstrapWithAdmin(): void {
  completeSetup(standardSetupInput());
  sessionManager.login(ADMIN_USER, ADMIN_PASSWORD);
}

export { getDb };
