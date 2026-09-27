/**
 * Interactive dental chart — FDI numbering.
 * Adult permanent teeth: 11-18, 21-28, 31-38, 41-48.
 * Pediatric primary teeth: 51-55, 61-65, 71-75, 81-85.
 * Each entry is historical: new conditions supersede older ones on the same tooth,
 * but history is retained (superseded_at is stamped, never deleted).
 */
import { getDb, tx } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError } from '../util/errors';
import { nowIso } from '../../shared/datetime';
import { audit } from './audit';

export const CHART_CONDITIONS = [
  'caries', 'restoration', 'missing', 'extraction', 'rct', 'crown',
  'fracture', 'mobility', 'impacted', 'infection', 'other',
] as const;

const ADULT_TEETH = new Set<number>([
  ...Array.from({ length: 8 }, (_, i) => 11 + i),
  ...Array.from({ length: 8 }, (_, i) => 21 + i),
  ...Array.from({ length: 8 }, (_, i) => 31 + i),
  ...Array.from({ length: 8 }, (_, i) => 41 + i),
]);
const PEDIATRIC_TEETH = new Set<number>([
  ...Array.from({ length: 5 }, (_, i) => 51 + i),
  ...Array.from({ length: 5 }, (_, i) => 61 + i),
  ...Array.from({ length: 5 }, (_, i) => 71 + i),
  ...Array.from({ length: 5 }, (_, i) => 81 + i),
]);

export function isValidTooth(tooth: number): boolean {
  return ADULT_TEETH.has(tooth) || PEDIATRIC_TEETH.has(tooth);
}

export function dentitionOf(tooth: number): 'adult' | 'pediatric' {
  return PEDIATRIC_TEETH.has(tooth) ? 'pediatric' : 'adult';
}

export interface ChartEntryInput {
  patientId: number;
  teeth: number[];                    // supports multi-select
  condition: (typeof CHART_CONDITIONS)[number];
  surface?: string;
  note?: string;
  visitId?: number | null;
  dentistId?: number | null;
}

export function addChartEntries(input: ChartEntryInput): { created: number } {
  sessionManager.ensurePermission('chart.edit');
  if (!Array.isArray(input.teeth) || input.teeth.length === 0) throw new ValidationError('Select at least one tooth.');
  if (!(CHART_CONDITIONS as readonly string[]).includes(input.condition)) throw new ValidationError('Unknown tooth condition.');
  for (const t of input.teeth) {
    if (!Number.isInteger(t) || !isValidTooth(t)) throw new ValidationError(`Tooth number ${t} is not a valid FDI tooth.`);
  }
  const db = getDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ValidationError('Patient not found.');
  const me = sessionManager.currentUser();
  const at = nowIso();

  let created = 0;
  tx(() => {
    const supersede = db.prepare(
      'UPDATE chart_entries SET superseded_at = ? WHERE patient_id = ? AND tooth_no = ? AND superseded_at IS NULL',
    );
    const ins = db.prepare(
      `INSERT INTO chart_entries (patient_id, tooth_no, condition, surface, dentition, note, visit_id, dentist_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const tooth of input.teeth) {
      supersede.run(at, input.patientId, tooth);
      ins.run(
        input.patientId,
        tooth,
        input.condition,
        input.surface?.trim() ?? '',
        dentitionOf(tooth),
        input.note?.trim() ?? '',
        input.visitId ?? null,
        input.dentistId ?? null,
        me.userId,
        at,
      );
      created++;
    }
    audit({
      action: 'chart.updated',
      entity: 'patient',
      entityId: input.patientId,
      details: { teeth: input.teeth, condition: input.condition },
    });
  });
  return { created };
}

/** Clear a condition (mark tooth as sound) by superseding active entries. */
export function clearTooth(patientId: number, tooth: number): void {
  sessionManager.ensurePermission('chart.edit');
  if (!isValidTooth(tooth)) throw new ValidationError(`Tooth number ${tooth} is not a valid FDI tooth.`);
  const res = getDb()
    .prepare('UPDATE chart_entries SET superseded_at = ? WHERE patient_id = ? AND tooth_no = ? AND superseded_at IS NULL')
    .run(nowIso(), patientId, tooth);
  audit({ action: 'chart.cleared', entity: 'patient', entityId: patientId, details: { tooth, cleared: res.changes } });
}

/** Current (active) chart state per tooth for the interactive chart. */
export function currentChart(patientId: number) {
  sessionManager.ensurePermission('clinical.view');
  interface ChartRow {
    id: number;
    tooth_no: number;
    condition: string;
    surface: string;
    dentition: string;
    note: string;
    created_at: string;
    dentist_name: string | null;
  }
  const rows = getDb()
    .prepare(
      `SELECT ce.id, ce.tooth_no, ce.condition, ce.surface, ce.dentition, ce.note, ce.created_at, d.full_name AS dentist_name
       FROM chart_entries ce LEFT JOIN dentists d ON d.id = ce.dentist_id
       WHERE ce.patient_id = ? AND ce.superseded_at IS NULL
       ORDER BY ce.tooth_no ASC`,
    )
    .all<ChartRow>(patientId);
  const byTooth = new Map<number, ChartRow>();
  for (const r of rows) byTooth.set(r.tooth_no, r);
  return { teeth: Object.fromEntries([...byTooth].map(([k, v]) => [String(k), v])), rows };
}

/** Full history for one tooth. */
export function toothHistory(patientId: number, tooth: number) {
  sessionManager.ensurePermission('clinical.view');
  if (!isValidTooth(tooth)) throw new NotFoundError('Tooth');
  return getDb()
    .prepare(
      `SELECT ce.*, d.full_name AS dentist_name FROM chart_entries ce LEFT JOIN dentists d ON d.id = ce.dentist_id
       WHERE ce.patient_id = ? AND ce.tooth_no = ? ORDER BY ce.created_at DESC, ce.id DESC`,
    )
    .all(patientId, tooth);
}

export { ADULT_TEETH, PEDIATRIC_TEETH };
