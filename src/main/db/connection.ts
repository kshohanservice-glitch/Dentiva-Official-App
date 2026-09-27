/**
 * Database connection manager: open, migrate, transactional helpers.
 * WAL journal mode, foreign keys enforced, busy timeout for robustness.
 */
import { openDatabase, type DatabaseHandle, type SqlValue } from './driver';
import { logger } from '../util/logger';

let db: DatabaseHandle | null = null;

export function getDb(): DatabaseHandle {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function hasDb(): boolean {
  return db !== null;
}

export function initDatabase(filePath: string): DatabaseHandle {
  if (db) return db;
  db = openDatabase(filePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  logger.info('database.opened', { driver: db.driverName, path: filePath });
  return db;
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      /* best effort */
    }
    db.close();
    db = null;
  }
}

/** Run fn inside an IMMEDIATE transaction. Rolls back on any error. */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* connection may be broken; surfaced by original error */
    }
    throw err;
  }
}

/** SQLite integrity check used at startup and after restore. */
export function integrityCheck(): boolean {
  const d = getDb();
  const row = d.prepare('PRAGMA integrity_check').get<{ integrity_check: string }>();
  return row?.integrity_check === 'ok';
}

// --- migrations -------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { applySeed } from './seed';

/**
 * Locate schema.sql. In dev/vitest this file lives next to the source. In the
 * packaged app the build copies it next to the bundled out/main/index.js.
 */
function locateSchemaFile(): string {
  const candidates = [
    path.join(__dirname, 'schema.sql'),
    path.join(__dirname, '..', '..', 'src', 'main', 'db', 'schema.sql'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('schema.sql not found');
}

function loadSchemaSql(): string {
  return fs.readFileSync(locateSchemaFile(), 'utf8');
}

function migrate(d: DatabaseHandle): void {
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = d
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all<{ version: number }>()
    .map((r) => r.version);

  if (!applied.includes(1)) {
    const schema = loadSchemaSql();
    d.exec('BEGIN');
    try {
      d.exec(schema);
      d.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
    applySeed(d);
    logger.info('database.migrated', { version: 1 });
  }
}

/** Re-run seed idempotently (used after migration & by setup integrity tools). */
export function reseed(): void {
  applySeed(getDb());
}

export function rawValue(v: SqlValue): SqlValue {
  return v;
}
