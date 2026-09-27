/**
 * Structured JSON-lines logger with rotation.
 * Streams: app, error, security. Secrets (passwords, activation codes) are never logged.
 */
import fs from 'node:fs';
import path from 'node:path';

export type LogStream = 'app' | 'error' | 'security';

const MAX_BYTES = 1_000_000; // 1 MB per file before rotation
const KEEP_FILES = 5;

let logDir = '';

export function initLogger(dir: string): void {
  logDir = dir;
  fs.mkdirSync(dir, { recursive: true });
}

function rotate(file: string): void {
  try {
    const st = fs.statSync(file);
    if (st.size < MAX_BYTES) return;
    for (let i = KEEP_FILES - 1; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      const to = `${file}.${i}`;
      if (fs.existsSync(from)) {
        if (i === KEEP_FILES - 1) fs.rmSync(to, { force: true });
        fs.renameSync(from, to);
      }
    }
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* rotation is best-effort */
  }
}

function write(stream: LogStream, level: string, msg: string, data?: Record<string, unknown>): void {
  if (!logDir) return;
  const file = path.join(logDir, stream === 'app' ? 'app.log' : `${stream}.log`);
  const entry = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...(data ?? {}),
  });
  try {
    rotate(file);
    fs.appendFileSync(file, entry + '\n');
  } catch {
    /* never crash the app because of logging */
  }
}

export const logger = {
  info: (msg: string, data?: Record<string, unknown>) => write('app', 'info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('app', 'warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', 'error', msg, data),
  security: (msg: string, data?: Record<string, unknown>) => write('security', 'info', msg, data),
};
