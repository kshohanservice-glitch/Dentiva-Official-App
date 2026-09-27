/**
 * Password hashing (scrypt) and activation-code verification.
 *
 * Passwords: scrypt with per-user 16-byte salt, N=16384, r=8, p=1, 64-byte key.
 * Never stored or logged in plaintext; compared with timingSafeEqual.
 *
 * Activation: the expected code is never present in source. We store scrypt(code, pepper)
 * as a hex digest (the "verifier"). At verification time we derive the same digest from
 * user input and compare in constant time. Honest limitation: this is a local-only
 * verifier — a determined attacker with access to the binaries could reverse engineer
 * it. This mechanism protects against casual extraction, not a hostile local admin.
 */
import crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return { hash: derived.toString('hex'), salt: salt.toString('hex') };
}

export function verifyPassword(password: string, hashHex: string, saltHex: string): boolean {
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(password, salt, expected.length, SCRYPT_PARAMS);
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Pepper mixed into the activation digest (not the secret itself). */
const ACTIVATION_PEPPER = Buffer.from('dentiva-pro::v1::activation', 'utf8');

export function deriveActivationVerifier(code: string): string {
  const normalized = code.replace(/[\s-]/g, '');
  const digest = crypto.scryptSync(normalized, ACTIVATION_PEPPER, 32, { N: 4096, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return digest.toString('hex');
}

export function verifyActivationCode(code: string, storedVerifierHex: string): boolean {
  try {
    const expected = Buffer.from(storedVerifierHex, 'hex');
    const derived = Buffer.from(deriveActivationVerifier(code), 'hex');
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Minimum password policy. */
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 6) return 'Password must be at least 6 characters long.';
  if (pw.length > 128) return 'Password is too long.';
  return null;
}

export function newSessionId(): string {
  return crypto.randomUUID();
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
