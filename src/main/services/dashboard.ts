/**
 * Dashboard aggregates — every metric computed from real rows, never hardcoded.
 */
import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { todayLocal } from '../../shared/datetime';

export function dashboardStats() {
  sessionManager.ensurePermission('dashboard.view');
  const db = getDb();
  const today = todayLocal();
  const canSeeFinancial = sessionManager.currentUser().permissions.has('financial.view');

  const apptsToday = db.prepare("SELECT COUNT(*) AS c FROM appointments WHERE appt_date = ? AND status != 'cancelled'").get<{ c: number }>(today)?.c ?? 0;
  const waiting = db.prepare("SELECT COUNT(*) AS c FROM queue_entries WHERE queue_date = ? AND status = 'waiting'").get<{ c: number }>(today)?.c ?? 0;
  const inTreatment = db.prepare("SELECT COUNT(*) AS c FROM queue_entries WHERE queue_date = ? AND status = 'in-treatment'").get<{ c: number }>(today)?.c ?? 0;
  const completedVisitsToday = db.prepare("SELECT COUNT(*) AS c FROM visits WHERE date(visit_date) = ? AND status = 'completed' AND deleted_at IS NULL").get<{ c: number }>(today)?.c ?? 0;
  const missedToday = db.prepare("SELECT COUNT(*) AS c FROM appointments WHERE appt_date = ? AND status = 'no-show'").get<{ c: number }>(today)?.c ?? 0;

  const newPatientsToday = db.prepare('SELECT COUNT(*) AS c FROM patients WHERE date(created_at) = ? AND deleted_at IS NULL').get<{ c: number }>(today)?.c ?? 0;
  const totalPatients = db.prepare('SELECT COUNT(*) AS c FROM patients WHERE deleted_at IS NULL').get<{ c: number }>()?.c ?? 0;

  let revenueToday = 0;
  let outstanding = 0;
  if (canSeeFinancial) {
    revenueToday = db.prepare("SELECT COALESCE(SUM(amount_paisa),0) AS s FROM payments WHERE date(paid_at) = ?").get<{ s: number }>(today)?.s ?? 0;
    outstanding = db.prepare("SELECT COALESCE(SUM(grand_total_paisa - paid_paisa),0) AS s FROM invoices WHERE status IN ('partial','unpaid') AND deleted_at IS NULL").get<{ s: number }>()?.s ?? 0;
  }

  const lowStock = db.prepare('SELECT COUNT(*) AS c FROM inventory_items WHERE is_active = 1 AND current_stock <= min_stock').get<{ c: number }>()?.c ?? 0;
  const expiringSoon = db.prepare("SELECT COUNT(*) AS c FROM inventory_items WHERE is_active = 1 AND expiry_date IS NOT NULL AND expiry_date != '' AND date(expiry_date) <= date('now', '+30 days')").get<{ c: number }>()?.c ?? 0;

  const recentPatients = db.prepare('SELECT id, patient_code, full_name, phone, created_at FROM patients WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 6').all();
  const upcoming = db.prepare(
    `SELECT a.id, a.appt_date, a.start_time, a.status, p.full_name AS patient_name, p.id AS patient_id, d.full_name AS dentist_name
     FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
     WHERE a.appt_date >= ? AND a.status IN ('scheduled','confirmed','rescheduled')
     ORDER BY a.appt_date ASC, a.start_time ASC LIMIT 6`,
  ).all(today);
  const recentPayments = canSeeFinancial
    ? db.prepare(
        `SELECT p.amount_paisa, p.paid_at, p.receipt_no, pm.name AS method, pt.full_name AS patient_name
         FROM payments p JOIN payment_methods pm ON pm.id = p.method_id JOIN patients pt ON pt.id = p.patient_id
         ORDER BY p.paid_at DESC LIMIT 6`,
      ).all()
    : [];

  const last7 = db.prepare(
    `SELECT date(paid_at) AS day, COALESCE(SUM(amount_paisa),0) AS total
     FROM payments WHERE paid_at >= datetime('now', '-7 days') GROUP BY date(paid_at)`,
  ).all<{ day: string; total: number }>();

  return {
    today,
    appointmentsToday: apptsToday,
    newPatientsToday,
    totalPatients,
    waitingQueue: waiting,
    inTreatment,
    completedVisitsToday,
    missedToday,
    revenueTodayPaisa: revenueToday,
    outstandingPaisa: outstanding,
    lowStockItems: lowStock,
    expiringItems: expiringSoon,
    canSeeFinancial,
    recentPatients,
    upcomingAppointments: upcoming,
    recentPayments,
    last7Revenue: canSeeFinancial ? last7 : [],
  };
}
