/**
 * Playwright `_electron` helpers for Dentiva Pro.
 *
 * Each test gets an isolated userData directory (via DENTIVA_USER_DATA) so
 * activation / setup / DB state never leak across runs. Electron and the native
 * better-sqlite3 binding are only available on CI (or a developer machine that
 * has successfully completed `npm install` with scripts) — locally the suite
 * is skipped when those binaries are missing.
 */
import { test as base, expect, type Page, _electron as electron, type ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const E2E_ADMIN_USER = 'admin';
export const E2E_ADMIN_PASSWORD = 'AdminPass!2026';
/**
 * Activation code for E2E. Prefer the repository secret DENTIVA_E2E_ACTIVATION_CODE
 * (production code, never committed). Fallback: CI-generated test-only code from
 * scripts/gen-e2e-activation.mjs — never the production code, never a fixture default
 * baked into source.
 */
export const E2E_ACTIVATION_CODE =
  process.env.DENTIVA_E2E_ACTIVATION_CODE?.trim() || process.env.DENTIVA_E2E_TEST_CODE?.trim() || '';

export function electronBinaryAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronPath = require('electron') as string;
    return typeof electronPath === 'string' && fs.existsSync(electronPath);
  } catch {
    return false;
  }
}

export function betterSqliteAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

/** True when the environment can launch the real Electron app end-to-end. */
export function e2eRunnable(): boolean {
  return electronBinaryAvailable() && betterSqliteAvailable() && Boolean(E2E_ACTIVATION_CODE);
}

/**
 * On CI we refuse to silently skip: missing Electron / native binding / activation
 * material must fail the job so a green check never means "47 tests skipped".
 */
export function assertE2eRunnableOrThrow(): void {
  const missing: string[] = [];
  if (!electronBinaryAvailable()) missing.push('Electron binary (npm install electron)');
  if (!betterSqliteAvailable()) missing.push('better-sqlite3 native binding');
  if (!E2E_ACTIVATION_CODE) {
    missing.push('DENTIVA_E2E_ACTIVATION_CODE secret or DENTIVA_E2E_TEST_CODE (from gen-e2e-activation.mjs)');
  }
  if (missing.length) {
    throw new Error(
      `E2E cannot run — missing: ${missing.join('; ')}. ` +
        'On CI the workflow must generate a test verifier or inject the activation secret.',
    );
  }
}

export interface AppHandle {
  app: ElectronApplication;
  page: Page;
  userData: string;
  close: () => Promise<void>;
}

async function ensureBuilt(): Promise<void> {
  const main = path.join(process.cwd(), 'out', 'main', 'index.js');
  const renderer = path.join(process.cwd(), 'out', 'renderer', 'index.html');
  if (!fs.existsSync(main) || !fs.existsSync(renderer)) {
    throw new Error(
      'Built app missing (out/main + out/renderer). Run `npm run build` before E2E, or let the CI workflow build first.',
    );
  }
}

/**
 * Launch Dentiva Pro with a fresh, disposable userData directory.
 * Caller is responsible for calling `close()` (or use the fixture below).
 */
export async function launchApp(opts: { userData?: string } = {}): Promise<AppHandle> {
  await ensureBuilt();
  const userData = opts.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-e2e-'));
  fs.mkdirSync(userData, { recursive: true });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronPath = require('electron') as string;
  const mainJs = path.join(process.cwd(), 'out', 'main', 'index.js');

  // Forward CI test verifier into the Electron main process so activation
  // accepts the test-only code without shipping production secrets.
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') childEnv[k] = v;
  }
  childEnv.DENTIVA_USER_DATA = userData;
  childEnv.ELECTRON_DISABLE_SECURITY_WARNINGS = '1';
  if (process.env.DENTIVA_E2E_TEST_VERIFIER) {
    childEnv.DENTIVA_E2E_TEST_VERIFIER = process.env.DENTIVA_E2E_TEST_VERIFIER;
  }

  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainJs],
    env: childEnv,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Boot splash → first real screen
  await page.waitForSelector('h2.dp-h2, .sidebar, .page-header', { timeout: 60_000 });

  return {
    app,
    page,
    userData,
    close: async () => {
      try {
        await app.close();
      } finally {
        try {
          fs.rmSync(userData, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    },
  };
}

/** Activate with the env-injected production code. */
export async function activateApp(page: Page, code = E2E_ACTIVATION_CODE): Promise<void> {
  await expect(page.getByRole('heading', { name: /Activate Dentiva Pro/i })).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder('Enter your activation code').fill(code);
  await page.getByRole('button', { name: /^Activate$/ }).click();
  // Next screen is either Setup or Sign in
  await page.waitForSelector('text=/Clinic Information|Sign in|Administrator/i', { timeout: 30_000 });
}

/** Drive the 5-step first-run setup wizard with deterministic clinic data. */
export async function completeSetup(
  page: Page,
  opts: {
    clinicName?: string;
    adminUser?: string;
    adminPassword?: string;
    dentistName?: string;
  } = {},
): Promise<void> {
  const clinicName = opts.clinicName ?? 'E2E Dental Care';
  const adminUser = opts.adminUser ?? E2E_ADMIN_USER;
  const adminPassword = opts.adminPassword ?? E2E_ADMIN_PASSWORD;
  const dentistName = opts.dentistName ?? 'Dr. Ayesha Rahman';

  // Step 0 — clinic
  await expect(page.getByText(/Clinic Information/i).first()).toBeVisible({ timeout: 30_000 });
  await fillField(page, /Clinic \/ Dental Care name|Clinic name/i, clinicName);
  await fillField(page, /^Phone$/i, '+8801700112233');
  await fillField(page, /^Address$/i, '12 Test Road, Dhaka').catch(() => undefined);
  await page.getByRole('button', { name: /^Next$/i }).click();

  // Step 1 — dentists
  await fillField(page, /^Full name$/i, dentistName);
  await page.getByRole('button', { name: /^Next$/i }).click();

  // Step 2 — admin
  await fillField(page, /^Username$/i, adminUser);
  await fillField(page, /^Password$/i, adminPassword);
  await fillField(page, /Confirm password/i, adminPassword);
  await page.getByRole('button', { name: /^Next$/i }).click();

  // Step 3 — preferences (defaults OK)
  await page.getByRole('button', { name: /^Next$/i }).click();

  // Step 4 — review & finish
  await page.getByRole('button', { name: /Finish setup/i }).click();
  await page.waitForSelector('text=/Sign in/i', { timeout: 60_000 });
}

export async function login(page: Page, user = E2E_ADMIN_USER, password = E2E_ADMIN_PASSWORD): Promise<void> {
  await expect(page.getByRole('heading', { name: /Sign in/i })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(/Username/i).fill(user);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /Sign in/i }).click();
  await page.waitForSelector('.sidebar, [aria-label="Main navigation"]', { timeout: 60_000 });
}

/** Fresh install → activate → setup → login, ready on the dashboard. */
export async function bootToDashboard(): Promise<AppHandle> {
  const handle = await launchApp();
  await activateApp(handle.page);
  await completeSetup(handle.page);
  await login(handle.page);
  await expect(handle.page.locator('.sidebar')).toBeVisible();
  return handle;
}

export async function goNav(page: Page, label: string | RegExp): Promise<void> {
  await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: label }).click();
}

/**
 * Fill the input/textarea inside a Field whose visible label matches `label`.
 * Works with the <label class="field"> wrapper used by the design system.
 */
export async function fillField(page: Page, label: string | RegExp, value: string): Promise<void> {
  const field = page.locator('label.field, .field').filter({ has: page.locator('.field-label', { hasText: label }) }).first();
  const control = field.locator('input, textarea, select').first();
  await control.waitFor({ state: 'visible', timeout: 15_000 });
  await control.fill(value);
}

export async function waitForToast(page: Page, kind?: 'success' | 'error' | 'info'): Promise<void> {
  const sel = kind ? `.toast.toast-${kind}, .toast[data-kind="${kind}"]` : '.toast';
  await page.locator(sel).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
}

/**
 * Playwright fixture.
 * - Local sandbox without Electron/native bindings: skip (developer machines
 *   that only run vitest).
 * - CI (CI=true): never skip — throw if prerequisites are missing so the job fails.
 */
export const test = base.extend<{ app: AppHandle }>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use, testInfo) => {
    if (!e2eRunnable()) {
      if (process.env.CI === 'true' || process.env.DENTIVA_E2E_REQUIRE === '1') {
        assertE2eRunnableOrThrow();
      }
      testInfo.skip(
        true,
        'E2E requires Electron binary + better-sqlite3 native binding + activation code env (CI provides these).',
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await use(null as any);
      return;
    }
    const handle = await launchApp();
    await use(handle);
    await handle.close();
  },
});

export { expect, electron, pathToFileURL };
