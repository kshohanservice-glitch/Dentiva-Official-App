/**
 * Notification center. Notifications are generated from real conditions
 * (never hardcoded), deduplicated by key, and actionable via in-app links.
 */
import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { nowIso, todayLocal } from '../../shared/datetime';

export function notify(kind: string, severity: 'info' | 'warning' | 'critical' | 'success', title: string, body = '', link = '', dedupeKey?: string): void {
  const db = getDb();
  if (dedupeKey) {
    const existing = db.prepare('SELECT id, is_read FROM notifications WHERE dedupe_key = ?').get<{ id: number; is_read: number }>(dedupeKey);
    if (existing) {
      db.prepare('UPDATE notifications SET title = ?, body = ?, severity = ?, is_read = 0 WHERE id = ?').run(title, body, severity, existing.id);
      return;
    }
  }
  db.prepare('INSERT INTO notifications (kind, severity, title, body, link, dedupe_key, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').run(
    kind,
    severity,
    title,
    body,
    link,
    dedupeKey ?? null,
    nowIso(),
  );
}

export function listNotifications(unreadOnly = false, limit = 50) {
  sessionManager.ensurePermission('notifications.view');
  return getDb()
    .prepare(`SELECT * FROM notifications ${unreadOnly ? 'WHERE is_read = 0' : ''} ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

export function unreadCount(): number {
  if (!sessionManager.hasSession() || sessionManager.isLocked()) return 0;
  return getDb().prepare('SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0').get<{ c: number }>()?.c ?? 0;
}

export function markRead(id: number): void {
  sessionManager.ensurePermission('notifications.view');
  getDb().prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
}

export function markAllRead(): void {
  sessionManager.ensurePermission('notifications.view');
  getDb().prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
}

/**
 * Refresh rule-generated notifications from live data. Called on startup and on
 * dashboard loads. Idempotent via dedupe keys.
 */
export function refreshAlertNotifications(): void {
  const db = getDb();
  const today = todayLocal();

  // Upcoming appointments today
  const appts = db
    .prepare(
      `SELECT a.id, a.start_time, p.full_name FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.appt_date = ? AND a.status IN ('scheduled','confirmed','rescheduled') ORDER BY a.start_time ASC`,
    )
    .all<{ id: number; start_time: string; full_name: string }>(today);
  if (appts.length > 0) {
    notify('appointment', 'info', `${appts.length} appointment${appts.length === 1 ? '' : 's'} today`, appts.slice(0, 5).map((a) => `${a.start_time} — ${a.full_name}`).join(' · '), 'page:appointments', `appts:${today}`);
  }

  // Missed (no-show) appointments
  const missed = db.prepare("SELECT COUNT(*) AS c FROM appointments WHERE appt_date = ? AND status = 'no-show'").get<{ c: number }>(today)?.c ?? 0;
  if (missed > 0) notify('appointment', 'warning', `${missed} missed appointment${missed === 1 ? '' : 's'} today`, 'Marked as no-show.', 'page:appointments', `missed:${today}`);

  // Waiting queue
  const waiting = db.prepare("SELECT COUNT(*) AS c FROM queue_entries WHERE queue_date = ? AND status = 'waiting'").get<{ c: number }>(today)?.c ?? 0;
  if (waiting > 0) notify('queue', 'info', `${waiting} patient${waiting === 1 ? '' : 's'} waiting in queue`, '', 'page:queue', `queue:${today}`);

  // Outstanding balances
  const outstanding = db
    .prepare("SELECT COUNT(*) AS c, COALESCE(SUM(grand_total_paisa - paid_paisa),0) AS s FROM invoices WHERE status IN ('partial','unpaid') AND deleted_at IS NULL")
    .get<{ c: number; s: number }>()!;
  if (outstanding.c > 0) {
    notify('balance', 'warning', `${outstanding.c} invoice${outstanding.c === 1 ? '' : 's'} with outstanding balance`, `Total due: ${(outstanding.s / 100).toFixed(2)} BDT`, 'page:payments', 'outstanding:total');
  }

  // Inventory alerts
  const low = db.prepare('SELECT COUNT(*) AS c FROM inventory_items WHERE is_active = 1 AND current_stock <= min_stock').get<{ c: number }>()?.c ?? 0;
  if (low > 0) notify('stock', 'warning', `${low} inventor${low === 1 ? 'y item is' : 'y items are'} at or below minimum stock`, '', 'page:inventory', 'stock:low');
  const expired = db.prepare("SELECT COUNT(*) AS c FROM inventory_items WHERE is_active = 1 AND expiry_date IS NOT NULL AND expiry_date != '' AND date(expiry_date) < date('now')").get<{ c: number }>()?.c ?? 0;
  if (expired > 0) notify('expiry', 'critical', `${expired} inventor${expired === 1 ? 'y item has' : 'y items have'} expired`, '', 'page:inventory', 'stock:expired');
  const expiring = db.prepare("SELECT COUNT(*) AS c FROM inventory_items WHERE is_active = 1 AND expiry_date IS NOT NULL AND expiry_date != '' AND date(expiry_date) >= date('now') AND date(expiry_date) <= date('now', '+30 days')").get<{ c: number }>()?.c ?? 0;
  if (expiring > 0) notify('expiry', 'warning', `${expiring} inventor${expiring === 1 ? 'y item expires' : 'y items expire'} within 30 days`, '', 'page:inventory', 'stock:expiring');
}
