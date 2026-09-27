/** Application-managed directories. All app data lives under the userData root. */
import path from 'node:path';

let userDataRoot = '';

export function initPaths(userData: string): void {
  userDataRoot = userData;
}

/** Test hook: redirect all app data to a temp directory. */
export function setUserDataRoot(dir: string): void {
  userDataRoot = dir;
}

export function dataDir(): string {
  return path.join(userDataRoot, 'data');
}
export function dbFile(): string {
  return path.join(dataDir(), 'dentiva.db');
}
export function attachmentsDir(): string {
  return path.join(dataDir(), 'attachments');
}
export function brandingDir(): string {
  return path.join(dataDir(), 'branding');
}
export function logsDir(): string {
  return path.join(userDataRoot, 'logs');
}
export function tempDir(): string {
  return path.join(userDataRoot, 'temp');
}
export function userDataRootDir(): string {
  return userDataRoot;
}

/** Sanitize a user-provided filename (attachments etc.). Never allows traversal. */
export function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-\u00A0-\uFFFF ]/g, '_').trim();
  return base.slice(0, 120) || 'file';
}
