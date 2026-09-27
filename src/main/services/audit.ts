import { getDb } from '../db/connection';
import { nowIso } from '../../shared/datetime';
import { sessionManager } from './session';

export interface AuditInput {
  action: string;
  entity?: string;
  entityId?: string | number;
  result?: 'success' | 'failure';
  details?: Record<string, unknown>;
}

/**
 * Append an audit entry. Actor is taken from the current session when not given.
 * Safe to call inside transactions — writes in the surrounding transaction.
 */
export function audit(input: AuditInput): void {
  const actor = sessionManager.currentActor();
  getDb()
    .prepare(
      'INSERT INTO audit_logs (at, user_id, username, action, entity, entity_id, result, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      nowIso(),
      actor?.userId ?? null,
      actor?.username ?? 'system',
      input.action,
      input.entity ?? '',
      input.entityId !== undefined ? String(input.entityId) : '',
      input.result ?? 'success',
      JSON.stringify(input.details ?? {}),
    );
}

export interface AuditQuery {
  from?: string;
  to?: string;
  userId?: number;
  action?: string;
  entity?: string;
  page: number;
  pageSize: number;
}

export function queryAuditLogs(q: AuditQuery) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q.from) {
    where.push('at >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('at <= ?');
    params.push(q.to);
  }
  if (q.userId) {
    where.push('user_id = ?');
    params.push(q.userId);
  }
  if (q.action) {
    where.push('action LIKE ?');
    params.push(`${q.action}%`);
  }
  if (q.entity) {
    where.push('entity = ?');
    params.push(q.entity);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${whereSql}`).get<{ c: number }>(...params)?.c ?? 0;
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize);
  return { total, rows };
}
