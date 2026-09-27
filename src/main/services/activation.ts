/**
 * One-time local activation.
 *
 * The accepted code exists ONLY as a scrypt-derived verifier digest (below); the
 * plaintext code is not present anywhere in source, resources, tests or logs.
 * Honest limitation: any local-only verifier can be reverse engineered by a
 * determined attacker with access to the installed binaries — this protects
 * against casual extraction, not a hostile local administrator.
 */
import { getDb } from '../db/connection';
import { deriveActivationVerifier, verifyActivationCode } from './security';
import { nowIso } from '../../shared/datetime';
import { AppError } from '../util/errors';
import { audit } from './audit';
import { logger } from '../util/logger';

/** Derived verifier for the shipped activation code (digest only — not the code). */
const SHIPPED_VERIFIER = '2f362d8cebfd0c7e6bfd9b5df17bdd264af7c1195f93af97986c9b0c60fa41e6';

/**
 * Optional CI/test-only verifier injected via env (hex digest). Never a production
 * code — allows E2E to activate against a throwaway test pair without embedding
 * the real activation code in the repository or workflow files.
 * Production builds leave this unset; only the SHIPPED_VERIFIER applies.
 */
function e2eTestVerifier(): string | null {
  const v = process.env.DENTIVA_E2E_TEST_VERIFIER?.trim();
  if (!v) return null;
  if (!/^[0-9a-f]{64}$/i.test(v)) return null;
  return v.toLowerCase();
}

export function isActivated(): boolean {
  const row = getDb().prepare('SELECT activated, verifier_hash FROM activation_state WHERE id = 1').get<{
    activated: number;
    verifier_hash: string | null;
  }>();
  if (!row) return false;
  if (row.activated === 1 && row.verifier_hash) return true;
  return false;
}

export function activate(code: string): void {
  const db = getDb();
  const row = db.prepare('SELECT activated, verifier_hash FROM activation_state WHERE id = 1').get<{
    activated: number;
    verifier_hash: string | null;
  }>();

  if (row?.activated === 1 && row.verifier_hash) {
    throw new AppError('ALREADY_ACTIVATED', 'Dentiva Pro is already activated on this computer.');
  }

  const normalized = code.replace(/[\s-]/g, '');
  if (!/^\d{10,32}$/.test(normalized)) {
    audit({ action: 'activation.failed', result: 'failure', details: { reason: 'format' } });
    throw new AppError('ACTIVATION_INVALID', 'The activation code you entered is not valid.');
  }

  // Accept the shipped verifier, an optional CI test verifier, or a previously stored one.
  const candidateVerifiers = [SHIPPED_VERIFIER, e2eTestVerifier(), row?.verifier_hash].filter(Boolean) as string[];
  const ok = candidateVerifiers.some((v) => verifyActivationCode(normalized, v));
  if (!ok) {
    audit({ action: 'activation.failed', result: 'failure', details: { reason: 'mismatch' } });
    throw new AppError('ACTIVATION_INVALID', 'The activation code you entered is not valid.');
  }

  db.prepare('UPDATE activation_state SET activated = 1, verifier_hash = ?, activated_at = ? WHERE id = 1').run(
    deriveActivationVerifier(normalized),
    nowIso(),
  );
  audit({ action: 'activation.success' });
  logger.security('activation.success', {});
}

export function activationStatus() {
  const row = getDb().prepare('SELECT activated, activated_at FROM activation_state WHERE id = 1').get<{
    activated: number;
    activated_at: string | null;
  }>();
  return { activated: row?.activated === 1, activatedAt: row?.activated_at ?? null };
}
