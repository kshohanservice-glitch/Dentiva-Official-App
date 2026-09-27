/**
 * SQLite driver abstraction.
 *
 * Production driver: better-sqlite3 (prebuilt native binding, bundled with the app).
 * Fallback driver:   Node's built-in node:sqlite (DatabaseSync) — used in test
 *                    sandboxes where native bindings cannot be compiled.
 *
 * Both drivers expose the same small synchronous surface used by the data layer,
 * and both execute identical SQL. Only positional parameters are used.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Statement {
  run(...params: SqlValue[]): RunResult;
  get<T = Record<string, unknown>>(...params: SqlValue[]): T | undefined;
  all<T = Record<string, unknown>>(...params: SqlValue[]): T[];
}

export interface DatabaseHandle {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  close(): void;
  readonly driverName: string;
}

export type SqlValue = string | number | bigint | null | Uint8Array;

function normalizeRunResult(r: { changes: number | bigint; lastInsertRowid: number | bigint }): RunResult {
  return {
    changes: Number(r.changes),
    lastInsertRowid: Number(r.lastInsertRowid),
  };
}

class BetterSqliteHandle implements DatabaseHandle {
  readonly driverName = 'better-sqlite3';
  constructor(private db: import('better-sqlite3').Database) {}
  prepare(sql: string): Statement {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: SqlValue[]) => normalizeRunResult(stmt.run(...(params as unknown[]))) as RunResult,
      get: <T>(...params: SqlValue[]) => stmt.get(...(params as unknown[])) as T | undefined,
      all: <T>(...params: SqlValue[]) => stmt.all(...(params as unknown[])) as T[],
    };
  }
  exec(sql: string): void {
    this.db.exec(sql);
  }
  close(): void {
    this.db.close();
  }
}

class NodeSqliteHandle implements DatabaseHandle {
  readonly driverName = 'node:sqlite';
  constructor(private db: import('node:sqlite').DatabaseSync) {}
  prepare(sql: string): Statement {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: SqlValue[]) => normalizeRunResult(stmt.run(...params) as { changes: number | bigint; lastInsertRowid: number | bigint }),
      get: <T>(...params: SqlValue[]) => stmt.get(...params) as T | undefined,
      all: <T>(...params: SqlValue[]) => stmt.all(...params) as T[],
    };
  }
  exec(sql: string): void {
    this.db.exec(sql);
  }
  close(): void {
    this.db.close();
  }
}

export function openDatabase(filePath: string): DatabaseHandle {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  // Production driver first.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require('better-sqlite3');
    const db = new BetterSqlite3(filePath);
    return new BetterSqliteHandle(db);
  } catch {
    // Fall back to the built-in driver (dev/test sandboxes).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(filePath);
    return new NodeSqliteHandle(db);
  }
}
