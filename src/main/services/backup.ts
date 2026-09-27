/**
 * Backup & restore.
 *
 * Backup = ZIP containing:
 *   - database/dentiva.db        (consistent snapshot via VACUUM INTO)
 *   - attachments/**             (app-managed files)
 *   - branding/**                (logo, signatures)
 *   - manifest.json              (app version, schema version, file list, SHA-256 per file, counts)
 *
 * Restore = validate ZIP + manifest → mandatory pre-restore backup → confirm →
 * swap DB file (with current closed) + restore files → integrity check.
 * On any failure before swap, nothing is destroyed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { getDb, closeDatabase, initDatabase, integrityCheck, dbFile } from '../db/connection';
import { sessionManager } from './session';
import { AppError, ValidationError } from '../util/errors';
import { attachmentsDir, brandingDir, dataDir, documentsDir } from '../util/paths';
import { nowIso } from '../../shared/datetime';
import { audit } from './audit';
import { notify } from './notifications';
import { logger } from '../util/logger';
import { getSettingInt, getSetting } from './settings';
import { APP_VERSION } from '../version';

const BACKUP_SCHEMA_VERSION = 1;

function defaultBackupFolder(): string {
  const configured = getSetting('backup_folder');
  if (configured && configured.trim()) return configured.trim();
  return path.join(documentsDir(), 'Dentiva Pro', 'Backups');
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function timestampName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `DentivaPro_Backup_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function addDirToZip(zip: yazl.ZipFile, dir: string, prefix: string): string[] {
  const added: string[] = [];
  if (!fs.existsSync(dir)) return added;
  const walk = (d: string, rel: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else if (entry.isFile()) {
        zip.addFile(abs, `${prefix}/${relPath}`);
        added.push(`${prefix}/${relPath}`);
      }
    }
  };
  walk(dir, '');
  return added;
}

export interface BackupResult {
  id: number;
  filePath: string;
  sizeBytes: number;
  sha256: string;
}

export async function createBackup(kind: 'manual' | 'auto' | 'pre-restore' = 'manual'): Promise<BackupResult> {
  if (kind === 'manual') sessionManager.ensurePermission('backup.create');
  const db = getDb();
  const folder = defaultBackupFolder();
  try {
    fs.mkdirSync(folder, { recursive: true });
  } catch {
    throw new AppError('BACKUP_FOLDER', `The backup folder is not writable: ${folder}`);
  }

  let target = path.join(folder, `${timestampName()}.zip`);
  let guard = 1;
  while (fs.existsSync(target)) {
    target = path.join(folder, `${timestampName()}_${guard++}.zip`);
  }

  const tmpSnapshot = path.join(folder, `.snapshot-${Date.now()}.db`);
  const manifestFiles: Array<{ path: string; sha256: string; bytes: number }> = [];
  let dbCounts: Record<string, number> = {};

  try {
    // 1) Consistent DB snapshot
    db.prepare('VACUUM INTO ?').run(tmpSnapshot);

    // 2) Build zip
    const zip = new yazl.ZipFile();
    zip.addFile(tmpSnapshot, 'database/dentiva.db');
    manifestFiles.push({ path: 'database/dentiva.db', sha256: sha256File(tmpSnapshot), bytes: fs.statSync(tmpSnapshot).size });
    for (const f of addDirToZip(zip, attachmentsDir(), 'attachments')) {
      manifestFiles.push({ path: f, sha256: sha256File(path.join(attachmentsDir(), f.replace(/^attachments\//, ''))), bytes: fs.statSync(path.join(attachmentsDir(), f.replace(/^attachments\//, ''))).size });
    }
    for (const f of addDirToZip(zip, brandingDir(), 'branding')) {
      manifestFiles.push({ path: f, sha256: sha256File(path.join(brandingDir(), f.replace(/^branding\//, ''))), bytes: fs.statSync(path.join(brandingDir(), f.replace(/^branding\//, ''))).size });
    }

    // 3) Manifest (counts from the live DB for informational purposes)
    const count = (table: string) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get<{ c: number }>()?.c ?? 0;
    dbCounts = { patients: count('patients'), visits: count('visits'), invoices: count('invoices'), payments: count('payments'), users: count('users') };
    const manifest = {
      generator: 'Dentiva Pro',
      appVersion: APP_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: nowIso(),
      kind,
      files: manifestFiles,
      counts: dbCounts,
    };
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'manifest.json');
    zip.end();

    // 4) Stream to disk
    const written = await writeZipToDisk(zip, target);

    // 5) Verify + record
    const sha = sha256File(target);
    const me = sessionManager.currentActor();
    const rec = getDb()
      .prepare('INSERT INTO backups (file_path, kind, status, size_bytes, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(target, kind, 'success', written, sha, me?.userId ?? null, nowIso());
    audit({ action: kind === 'auto' ? 'backup.auto' : kind === 'pre-restore' ? 'backup.pre_restore' : 'backup.created', entity: 'backup', entityId: rec.lastInsertRowid, details: { file: path.basename(target) } });
    logger.info('backup.created', { file: target, bytes: written });
    return { id: rec.lastInsertRowid, filePath: target, sizeBytes: written, sha256: sha };
  } catch (err) {
    try {
      fs.rmSync(tmpSnapshot, { force: true });
    } catch {
      /* cleanup best-effort */
    }
    getDb()
      .prepare('INSERT INTO backups (file_path, kind, status, size_bytes, sha256, error, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)')
      .run(target, kind, 'failed', '', String(err instanceof Error ? err.message : err), sessionManager.currentActor()?.userId ?? null, nowIso());
    logger.error('backup.failed', { file: target, message: String(err) });
    throw err;
  } finally {
    try {
      fs.rmSync(tmpSnapshot, { force: true });
    } catch {
      /* already removed */
    }
  }
}

/** Stream a yazl ZipFile to disk, resolving with the byte count when complete. */
function writeZipToDisk(zip: yazl.ZipFile, target: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const out = fs.createWriteStream(target);
    let bytes = 0;
    zip.outputStream.on('data', (c: Buffer) => (bytes += c.length));
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(out);
    out.on('close', () => resolve(bytes));
    out.on('error', reject);
  });
}

export function listBackups() {
  sessionManager.ensurePermission('backup.create');
  const rows = getDb()
    .prepare('SELECT b.*, u.display_name AS created_by_name FROM backups b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.created_at DESC LIMIT 200')
    .all<Record<string, unknown>>();
  // Annotate existence (files may have been moved/deleted by the user)
  const out: Array<Record<string, unknown> & { exists: boolean }> = rows.map((r) => ({
    ...r,
    exists: typeof r.file_path === 'string' && fs.existsSync(r.file_path),
  }));
  return out;
}

export interface Manifest {
  generator: string;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  kind?: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  counts?: Record<string, number>;
}

export function validateBackupFile(zipPath: string): Promise<Manifest> {
  return new Promise<Manifest>((resolve, reject) => {
    if (!fs.existsSync(zipPath)) return reject(new ValidationError('Backup file not found.'));
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(new ValidationError('The backup file is corrupted or not a valid ZIP.'));
      let manifestRaw: Buffer | null = null;
      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName === 'manifest.json') {
          zipfile.openReadStream(entry, (e, stream) => {
            if (e || !stream) return reject(new ValidationError('Cannot read backup manifest.'));
            const chunks: Buffer[] = [];
            stream.on('data', (c: Buffer) => chunks.push(c));
            stream.on('end', () => {
              manifestRaw = Buffer.concat(chunks);
              zipfile.readEntry();
            });
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => {
        if (!manifestRaw) return reject(new ValidationError('Backup has no manifest — it is not a Dentiva Pro backup.'));
        try {
          const manifest = JSON.parse(manifestRaw.toString('utf8')) as Manifest;
          if (!Array.isArray(manifest.files) || !manifest.schemaVersion) {
            return reject(new ValidationError('Backup manifest is invalid.'));
          }
          if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
            return reject(new ValidationError('This backup was created by a newer version of Dentiva Pro and cannot be restored.'));
          }
          resolve(manifest);
        } catch {
          reject(new ValidationError('Backup manifest is corrupted.'));
        }
      });
      zipfile.on('error', () => reject(new ValidationError('The backup file is corrupted.')));
    });
  });
}

/**
 * Full restore. Requires explicit confirmation string "RESTORE" and the destructive permission.
 * Flow: validate → pre-restore backup → close DB → extract to staging → verify hashes →
 * swap files → reopen DB → integrity check. Old data is preserved in the pre-restore backup.
 */
export async function restoreBackup(zipPath: string, confirmation: string): Promise<{ restored: string }> {
  sessionManager.ensurePermission('backup.restore');
  sessionManager.ensurePermission('destructive.operations');
  if (confirmation !== 'RESTORE') throw new ValidationError('Type RESTORE to confirm.');

  const manifest = await validateBackupFile(zipPath);
  logger.info('restore.start', { file: zipPath });

  // Mandatory pre-restore backup (never destroy current data without a way back).
  const preRestore = await createBackup('pre-restore');

  const stage = path.join(dataDir(), `restore-stage-${Date.now()}`);
  fs.mkdirSync(stage, { recursive: true });

  try {
    // Extract
    await extractZip(zipPath, stage);

    // Verify manifest hashes
    for (const f of manifest.files) {
      const p = path.join(stage, f.path);
      if (!fs.existsSync(p)) throw new ValidationError(`Backup is incomplete: ${f.path} is missing.`);
      const sha = sha256File(p);
      if (sha !== f.sha256) throw new ValidationError(`Backup is corrupted: ${f.path} failed its integrity check.`);
    }
    const stagedDb = path.join(stage, 'database', 'dentiva.db');
    if (!fs.existsSync(stagedDb)) throw new ValidationError('Backup contains no database file.');

    // Swap: close current DB, back it aside, move staged data in place.
    closeDatabase();
    const live = dbFile();
    const aside = `${live}.pre-restore-${Date.now()}`;
    try {
      fs.renameSync(live, aside);
    } catch {
      /* first-run restore with no live db */
    }
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.rmSync(live + suffix, { force: true });
      } catch {
        /* may not exist */
      }
    }
    fs.copyFileSync(stagedDb, live);

    const stagedAttach = path.join(stage, 'attachments');
    if (fs.existsSync(stagedAttach)) {
      fs.rmSync(attachmentsDir(), { recursive: true, force: true });
      fs.cpSync(stagedAttach, attachmentsDir(), { recursive: true });
    }
    const stagedBrand = path.join(stage, 'branding');
    if (fs.existsSync(stagedBrand)) {
      fs.rmSync(brandingDir(), { recursive: true, force: true });
      fs.cpSync(stagedBrand, brandingDir(), { recursive: true });
    }

    initDatabase(live);
    // Record the pre-restore backup inside the restored database so the history
    // remains visible and auditable after the swap.
    try {
      getDb()
        .prepare('INSERT INTO backups (file_path, kind, status, size_bytes, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          preRestore.filePath,
          'pre-restore',
          'success',
          preRestore.sizeBytes,
          preRestore.sha256,
          sessionManager.currentActor()?.userId ?? null,
          nowIso(),
        );
    } catch {
      /* schema may differ in a future-version backup; restore itself already succeeded */
    }
    if (!integrityCheck()) {
      // Roll back to pre-restore state
      closeDatabase();
      fs.copyFileSync(aside, live);
      initDatabase(live);
      throw new AppError('RESTORE_VERIFY_FAILED', 'The restored database failed its integrity check; the previous data was reinstated from the pre-restore copy.');
    }

    audit({ action: 'restore.completed', entity: 'backup', details: { file: path.basename(zipPath), preRestoreBackup: preRestore.filePath } });
    logger.info('restore.completed', { file: zipPath });
    return { restored: path.basename(zipPath) };
  } catch (err) {
    logger.error('restore.failed', { file: zipPath, message: String(err) });
    audit({ action: 'restore.failed', result: 'failure', details: { file: path.basename(zipPath), message: String(err instanceof Error ? err.message : err) } });
    throw err;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** Extract a zip into a staging directory (path-traversal safe). */
function extractZip(zipPath: string, dest: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(new ValidationError('Cannot open backup file.'));
      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        const clean = path.normalize(entry.fileName).replace(/^(\.\.[/\\])+/, '');
        const target = path.join(dest, clean);
        if (!target.startsWith(dest + path.sep) && target !== dest) {
          return reject(new ValidationError('Backup contains an unsafe file path.'));
        }
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(target, { recursive: true });
          zipfile.readEntry();
        } else {
          zipfile.openReadStream(entry, (e, stream) => {
            if (e || !stream) return reject(new ValidationError('Cannot read backup contents.'));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const out = fs.createWriteStream(target);
            stream.pipe(out);
            out.on('close', () => zipfile.readEntry());
            out.on('error', reject);
          });
        }
      });
      zipfile.on('end', resolve);
      zipfile.on('error', () => reject(new ValidationError('The backup file is corrupted.')));
    });
  });
}

/** Automatic backup due-check, called at startup. */
export async function runAutoBackupIfDue(): Promise<void> {
  const days = getSettingInt('auto_backup_days', 7);
  if (days <= 0) return;
  const db = getDb();
  const last = db.prepare("SELECT created_at FROM backups WHERE kind IN ('auto','manual') AND status = 'success' ORDER BY created_at DESC LIMIT 1").get<{ created_at: string }>();
  const due = !last || Date.now() - new Date(last.created_at).getTime() > days * 86400_000;
  if (!due) return;
  try {
    await createBackup('auto');
  } catch (err) {
    logger.error('backup.auto_failed', { message: String(err) });
    try {
      notify('backup', 'critical', 'Automatic backup failed', err instanceof Error ? err.message : String(err), 'page:backup', 'backup:auto-fail');
    } catch {
      /* notification subsystem unavailable */
    }
  }
}

/** Retention: keep only the N most recent successful backups in the configured folder. */
export function applyBackupRetention(): number {
  const keep = Math.max(1, getSettingInt('backup_retention', 10));
  const db = getDb();
  const old = db
    .prepare("SELECT id, file_path FROM backups WHERE status = 'success' ORDER BY created_at DESC LIMIT -1 OFFSET ?")
    .all<{ id: number; file_path: string }>(keep);
  let removed = 0;
  for (const row of old) {
    try {
      fs.rmSync(row.file_path, { force: true });
    } catch {
      /* file may already be gone */
    }
    db.prepare('DELETE FROM backups WHERE id = ?').run(row.id);
    removed++;
  }
  return removed;
}

export function backupFolder(): string {
  return defaultBackupFolder();
}
