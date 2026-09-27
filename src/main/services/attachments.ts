/**
 * Attachments — file-system safe by construction:
 * - files stored under the app-managed attachments dir with opaque IDs
 * - original names sanitized; no user-controlled paths (no traversal possible)
 * - extension allow-list; executables rejected
 * - size capped (configurable, default 25 MB)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb } from '../db/connection';
import { sessionManager } from './session';
import { ValidationError, NotFoundError, AppError } from '../util/errors';
import { attachmentsDir } from '../util/paths';
import { nowIso } from '../../shared/datetime';
import { audit } from './audit';

const MAX_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.pdf', '.txt', '.csv',
  '.doc', '.docx', '.xls', '.xlsx',
]);

const ENTITY_TYPES = new Set(['patient', 'visit', 'prescription', 'expense', 'income', 'staff']);

export function addAttachment(opts: {
  entityType: string;
  entityId: number;
  fileName: string;
  dataBase64: string;
  note?: string;
}): { id: number; storedName: string } {
  sessionManager.ensurePermission('patients.edit'); // attachments hang off clinical/patient records
  if (!ENTITY_TYPES.has(opts.entityType)) throw new ValidationError('Unknown attachment owner.');
  const ext = path.extname(opts.fileName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new ValidationError(`File type "${ext || '(none)'}" is not allowed. Allowed: ${[...ALLOWED_EXT].join(', ')}`);
  }
  const data = Buffer.from(opts.dataBase64, 'base64');
  if (data.length === 0) throw new ValidationError('The file is empty.');
  if (data.length > MAX_SIZE_BYTES) throw new ValidationError('The file is larger than the 25 MB limit.');

  const dir = attachmentsDir();
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `${crypto.randomUUID()}${ext}`;
  const target = path.join(dir, storedName);
  // path.join with a basename-only storedName cannot escape dir; double-check anyway.
  if (!target.startsWith(dir + path.sep)) throw new AppError('UNSAFE_PATH', 'Invalid file name.');
  fs.writeFileSync(target, data);

  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const base = path.basename(opts.fileName).slice(0, 160) || `attachment${ext}`;
  const me = sessionManager.currentUser();
  const res = getDb()
    .prepare(
      'INSERT INTO attachments (entity_type, entity_id, stored_name, original_name, mime_type, size_bytes, sha256, note, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(opts.entityType, opts.entityId, storedName, base, mimeFor(ext), data.length, sha, opts.note?.trim() ?? '', me.userId, nowIso());
  audit({ action: 'attachment.added', entity: opts.entityType, entityId: opts.entityId, details: { file: base, bytes: data.length } });
  return { id: res.lastInsertRowid, storedName };
}

function mimeFor(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.csv': 'text/csv', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function listAttachments(entityType: string, entityId: number) {
  sessionManager.ensurePermission('patients.view');
  if (!ENTITY_TYPES.has(entityType)) throw new ValidationError('Unknown attachment owner.');
  return getDb()
    .prepare('SELECT id, original_name, mime_type, size_bytes, note, created_at, deleted_at FROM attachments WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
    .all(entityType, entityId);
}

export function readAttachment(id: number): { fileName: string; dataBase64: string; mimeType: string } {
  sessionManager.ensurePermission('patients.view');
  const row = getDb().prepare('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL').get<{
    stored_name: string;
    original_name: string;
    mime_type: string;
  }>(id);
  if (!row) throw new NotFoundError('Attachment');
  const file = path.join(attachmentsDir(), path.basename(row.stored_name));
  if (!file.startsWith(attachmentsDir() + path.sep) || !fs.existsSync(file)) {
    throw new AppError('FILE_MISSING', 'The attachment file is missing from storage.');
  }
  const buf = fs.readFileSync(file);
  return { fileName: row.original_name, dataBase64: buf.toString('base64'), mimeType: row.mime_type };
}

export function deleteAttachment(id: number): void {
  sessionManager.ensurePermission('patients.delete');
  const db = getDb();
  const row = db.prepare('SELECT stored_name FROM attachments WHERE id = ? AND deleted_at IS NULL').get<{ stored_name: string }>(id);
  if (!row) throw new NotFoundError('Attachment');
  db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').run(nowIso(), id);
  try {
    fs.rmSync(path.join(attachmentsDir(), path.basename(row.stored_name)), { force: true });
  } catch {
    /* metadata soft-deleted even if the file is already gone */
  }
  audit({ action: 'attachment.deleted', entity: 'attachment', entityId: id });
}
