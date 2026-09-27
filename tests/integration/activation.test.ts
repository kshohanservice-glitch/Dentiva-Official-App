import fs from 'node:fs';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { freshDb, type TestCtx } from './helpers';
import { activate, activationStatus, isActivated } from '../../src/main/services/activation';
import { deriveActivationVerifier, verifyActivationCode } from '../../src/main/services/security';
import { AppError } from '../../src/main/util/errors';
import { getDb } from '../../src/main/db/connection';

/**
 * Security note (master prompt §14): these tests intentionally do NOT contain the
 * production activation code in plaintext. They exercise the verification machinery
 * with a test-only verifier and assert rejection behavior.
 */
let ctx: TestCtx;
afterEach(() => ctx?.cleanup());

describe('activation system', () => {
  it('starts unactivated', () => {
    ctx = freshDb();
    expect(isActivated()).toBe(false);
    expect(activationStatus().activated).toBe(false);
  });

  it('rejects malformed codes', () => {
    ctx = freshDb();
    expect(() => activate('12ab')).toThrow(AppError);
    expect(() => activate('')).toThrow(AppError);
    expect(() => activate('123')).toThrow(AppError);
    expect(isActivated()).toBe(false);
  });

  it('rejects a well-formed but wrong code with a generic message', () => {
    ctx = freshDb();
    let msg = '';
    try {
      activate('9999999999999999');
    } catch (e) {
      msg = (e as AppError).message;
    }
    expect(msg).toBe('The activation code you entered is not valid.');
    expect(msg).not.toContain('9999');
    expect(isActivated()).toBe(false);
    // failed attempts are audited
    const n = getDb().prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'activation.failed'").get<{ c: number }>()!.c;
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('activates against a stored verifier, persists, and refuses re-activation', () => {
    ctx = freshDb();
    // Simulate a verifier provisioned for this installation (test-only code).
    const testCode = '1111222233334444';
    getDb().prepare('UPDATE activation_state SET verifier_hash = ? WHERE id = 1').run(deriveActivationVerifier(testCode));

    activate(testCode);
    expect(isActivated()).toBe(true);
    const status = activationStatus();
    expect(status.activated).toBe(true);
    expect(status.activatedAt).not.toBeNull();

    expect(() => activate(testCode)).toThrow('already activated');
    // audit success entry present
    const ok = getDb().prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'activation.success'").get<{ c: number }>()!.c;
    expect(ok).toBe(1);
  });

  it('verifier digests are deterministic and timing-safe comparable', () => {
    const v1 = deriveActivationVerifier('4242424242424242');
    const v2 = deriveActivationVerifier('4242424242424242');
    expect(v1).toBe(v2);
    expect(verifyActivationCode('4242424242424242', v1)).toBe(true);
    expect(verifyActivationCode('4242424242424241', v1)).toBe(false);
    expect(verifyActivationCode('4242424242424242', 'nonsense')).toBe(false);
  });

  it('source contains no plaintext copy of the production code (guard test)', () => {
    // Guard: the shipped verifier constant is a 64-char hex digest, never the code itself.
    const src = fs.readFileSync('src/main/services/activation.ts', 'utf8');
    const shipped = src.match(/SHIPPED_VERIFIER = '([0-9a-f]+)'/);
    expect(shipped).not.toBeNull();
    expect(shipped![1]).toHaveLength(64); // sha/scrypt digest, not the numeric code
    // The whole source tree must not contain a 16-digit all-numeric activation constant.
    const files = [
      'src/main/services/activation.ts',
      'src/main/services/security.ts',
      'src/preload/index.ts',
    ];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text.match(/['"`]\d{16}['"`]/)).toBeNull();
    }
  });
});

describe('CI test-only activation verifier (E2E path)', () => {
  it('accepts a code matching DENTIVA_E2E_TEST_VERIFIER without using the production code', () => {
    ctx = freshDb();
    // Generate the same deterministic test pair the CI script uses.
    const testCode = '0000111122223333';
    const pepper = Buffer.from('dentiva-pro::v1::activation', 'utf8');
    const verifier = crypto
      .scryptSync(testCode, pepper, 32, { N: 4096, r: 8, p: 1, maxmem: 32 * 1024 * 1024 })
      .toString('hex');
    process.env.DENTIVA_E2E_TEST_VERIFIER = verifier;
    try {
      expect(() => activate(testCode)).not.toThrow();
      expect(isActivated()).toBe(true);
    } finally {
      delete process.env.DENTIVA_E2E_TEST_VERIFIER;
    }
  });

  it('still rejects a wrong code even when a test verifier is set', () => {
    ctx = freshDb();
    process.env.DENTIVA_E2E_TEST_VERIFIER = 'a'.repeat(64);
    try {
      expect(() => activate('9999999999999999')).toThrow();
      expect(isActivated()).toBe(false);
    } finally {
      delete process.env.DENTIVA_E2E_TEST_VERIFIER;
    }
  });
});
