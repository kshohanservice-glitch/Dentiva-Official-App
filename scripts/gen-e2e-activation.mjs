/**
 * Generate a TEST-ONLY activation code + scrypt verifier for CI E2E.
 *
 * This is NEVER the production activation code. The production verifier remains
 * the only shipped digest in activation.ts. CI uses this pair when the
 * repository secret DENTIVA_E2E_ACTIVATION_CODE is unset, so the 47 flows can
 * still execute without embedding production secrets in the workflow file.
 *
 * Outputs GitHub Actions-style "name=value" lines for GITHUB_OUTPUT.
 * The plaintext test code is masked in logs via ::add-mask::.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const PEPPER = Buffer.from('dentiva-pro::v1::activation', 'utf8');

function deriveVerifier(code) {
  const normalized = String(code).replace(/[\s-]/g, '');
  const digest = crypto.scryptSync(normalized, PEPPER, 32, {
    N: 4096,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  });
  return digest.toString('hex');
}

// Deterministic test-only code (16 digits). Distinct from any production code
// by construction: starts with 0000 and is documented as CI-only.
// Safe to appear in this generator script — it is NOT the shipped product code.
const TEST_CODE = process.env.DENTIVA_CI_TEST_CODE || '0000111122223333';

if (!/^\d{10,32}$/.test(TEST_CODE)) {
  console.error('DENTIVA_CI_TEST_CODE must be 10–32 digits');
  process.exit(1);
}

const verifier = deriveVerifier(TEST_CODE);

// Never print the code in plain CI logs — mask first.
console.log(`::add-mask::${TEST_CODE}`);
console.log(`code=${TEST_CODE}`);
console.log(`verifier=${verifier}`);
console.log(`mode=test_only`);

// Optional write for local debugging (gitignored paths only).
if (process.env.DENTIVA_WRITE_E2E_ACT_FILE) {
  const out = process.env.DENTIVA_WRITE_E2E_ACT_FILE;
  fs.writeFileSync(out, JSON.stringify({ mode: 'test_only', verifier }, null, 2));
}
