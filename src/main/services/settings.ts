import { getDb } from '../db/connection';

export function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(key);
  return row?.value;
}

export function getSettingInt(key: string, fallback: number): number {
  const v = getSetting(key);
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setManySettings(entries: Record<string, string>): void {
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const [k, v] of Object.entries(entries)) stmt.run(k, v);
}

/** Consume a numbered sequence (invoices, receipts, prescriptions, patient codes). */
export function nextSequence(settingKey: string, prefixSettingKey: string, padTo = 5): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(settingKey);
  const current = Math.max(1, parseInt(row?.value ?? '1', 10) || 1);
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(current + 1), settingKey);
  const prefix = getDb().prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(prefixSettingKey)?.value ?? '';
  return `${prefix}${String(current).padStart(padTo, '0')}`;
}
