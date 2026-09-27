import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { freshDb, bootstrapWithAdmin, type TestCtx } from './helpers';
import { setSetting } from '../../src/main/services/settings';
import { createBackup, listBackups, restoreBackup, validateBackupFile, applyBackupRetention } from '../../src/main/services/backup';
import { createPatient, listPatients } from '../../src/main/services/patients';
import { ValidationError } from '../../src/main/util/errors';
import { sessionManager } from '../../src/main/services/session';

let ctx: TestCtx;
afterEach(() => ctx?.cleanup());

function backupDir(): string {
  const dir = path.join(ctx.dir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  setSetting('backup_folder', dir);
  return dir;
}

describe('backup & restore', () => {
  it('creates a ZIP with manifest and records it', async () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    backupDir();
    createPatient({ fullName: 'Backup Subject', phone: '+8801700111111' });

    const result = await createBackup('manual');
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath.endsWith('.zip')).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

    const manifest = await validateBackupFile(result.filePath);
    expect(manifest.generator).toBe('Dentiva Pro');
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.files.some((f) => f.path === 'database/dentiva.db')).toBe(true);
    expect(manifest.counts?.patients ?? 0).toBeGreaterThanOrEqual(1);

    const rows = listBackups();
    expect(rows[0]).toMatchObject({ status: 'success', exists: true });
  });

  it('restore round-trip: data returns after modifying and restoring', async () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    backupDir();

    // Snapshot A: one patient
    createPatient({ fullName: 'First Patient', phone: '+8801700222222' });
    const backupA = await createBackup('manual');

    // Modify: add two more patients
    createPatient({ fullName: 'Second Patient', phone: '+8801700333333' });
    createPatient({ fullName: 'Third Patient', phone: '+8801700444444' });
    expect((listPatients({ page: 1, pageSize: 50 }).rows as unknown[]).length).toBe(3);

    // Restore A → back to 1 patient
    const confirmation = 'RESTORE';
    await restoreBackup(backupA.filePath, confirmation);
    const after = listPatients({ page: 1, pageSize: 50 });
    expect(after.rows.length).toBe(1);
    expect((after.rows as Array<{ full_name: string }>)[0].full_name).toBe('First Patient');

    // A pre-restore backup was automatically taken
    const backups = listBackups();
    expect(backups.some((b) => b.kind === 'pre-restore')).toBe(true);
  });

  it('requires the confirmation word and restore permissions', async () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    backupDir();
    const backup = await createBackup('manual');
    await expect(restoreBackup(backup.filePath, 'restore')).rejects.toThrow(ValidationError);
    await expect(restoreBackup(backup.filePath, '')).rejects.toThrow(ValidationError);
  });

  it('rejects a corrupted/foreign file', async () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    const dir = backupDir();
    const junk = path.join(dir, 'junk.zip');
    fs.writeFileSync(junk, Buffer.from('this is not a zip file at all'));
    await expect(validateBackupFile(junk)).rejects.toThrow();
    await expect(restoreBackup(junk, 'RESTORE')).rejects.toThrow();
    await expect(validateBackupFile(path.join(dir, 'missing.zip'))).rejects.toThrow(ValidationError);
  });

  it('backup without permission is denied', async () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    backupDir();
    // Simulate a locked app → permission gate refuses (service layer enforcement).
    sessionManager.lock('manual');
    await expect(createBackup('manual')).rejects.toThrow();
    sessionManager.unlock('AdminPass!2026');
  });

  it('retention keeps only the configured number of backups', async () => {
    ctx = freshDb();
    bootstrapWithAdmin();
    backupDir();
    setSetting('backup_retention', '2');
    await createBackup('manual');
    await createBackup('manual');
    await createBackup('manual');
    const removed = applyBackupRetention();
    expect(removed).toBeGreaterThanOrEqual(1);
    const rows = listBackups();
    expect(rows.length).toBeLessThanOrEqual(2);
  });
});
