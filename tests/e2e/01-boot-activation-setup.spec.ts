/**
 * Flows 1–8: cold boot, activation (valid/invalid), setup wizard, login, lock, logout.
 */
import { test, expect, e2eRunnable, assertE2eRunnableOrThrow, launchApp, activateApp, completeSetup, login, E2E_ADMIN_USER, E2E_ADMIN_PASSWORD, E2E_ACTIVATION_CODE } from './helpers';

test.describe('Boot · Activation · Setup · Auth (flows 1–8)', () => {
  test.beforeAll(() => {
    if (process.env.CI === 'true' || process.env.DENTIVA_E2E_REQUIRE === '1') {
      assertE2eRunnableOrThrow();
    } else if (!e2eRunnable()) {
      test.skip(true, 'Local sandbox: Electron/native/activation not available');
    }
  });

  test('1 · cold boot shows Activation screen on a fresh userData', async () => {
    const h = await launchApp();
    try {
      await expect(h.page.getByRole('heading', { name: /Activate Dentiva Pro/i })).toBeVisible();
      await expect(h.page.getByPlaceholder('Enter your activation code')).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('2 · invalid activation code is rejected with a clear error', async () => {
    const h = await launchApp();
    try {
      await h.page.getByPlaceholder('Enter your activation code').fill('0000000000000000');
      await h.page.getByRole('button', { name: /^Activate$/ }).click();
      await expect(h.page.locator('.field-error, .alert-error, [class*="error"]').first()).toBeVisible({ timeout: 10_000 });
      // Still on activation
      await expect(h.page.getByRole('heading', { name: /Activate Dentiva Pro/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('3 · empty activation code is blocked client-side', async () => {
    const h = await launchApp();
    try {
      await h.page.getByRole('button', { name: /^Activate$/ }).click();
      await expect(h.page.getByText(/enter your activation code/i)).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('4 · valid activation code advances to the setup wizard', async () => {
    const h = await launchApp();
    try {
      await activateApp(h.page, E2E_ACTIVATION_CODE);
      await expect(h.page.getByText(/Clinic Information/i).first()).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('5 · setup wizard completes and lands on Sign in', async () => {
    const h = await launchApp();
    try {
      await activateApp(h.page);
      await completeSetup(h.page);
      await expect(h.page.getByRole('heading', { name: /Sign in/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('6 · bad credentials are rejected', async () => {
    const h = await launchApp();
    try {
      await activateApp(h.page);
      await completeSetup(h.page);
      await h.page.getByLabel(/Username/i).fill(E2E_ADMIN_USER);
      await h.page.locator('input[type=password]').fill('WrongPassword!!!');
      await h.page.getByRole('button', { name: /Sign in/i }).click();
      await expect(h.page.locator('.field-error, .alert-error, [class*="error"]').first()).toBeVisible({ timeout: 10_000 });
      await expect(h.page.getByRole('heading', { name: /Sign in/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('7 · successful login reaches the dashboard shell', async () => {
    const h = await launchApp();
    try {
      await activateApp(h.page);
      await completeSetup(h.page);
      await login(h.page);
      await expect(h.page.locator('.sidebar')).toBeVisible();
      await expect(h.page.getByText(/Dashboard|Today|Overview/i).first()).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('8 · lock (Ctrl+L) and unlock with the correct password', async () => {
    const h = await launchApp();
    try {
      await activateApp(h.page);
      await completeSetup(h.page);
      await login(h.page);
      await h.page.keyboard.press('Control+l');
      await expect(h.page.getByText(/Locked|Unlock/i).first()).toBeVisible({ timeout: 15_000 });
      await h.page.locator('input[type=password]').fill(E2E_ADMIN_PASSWORD);
      await h.page.getByRole('button', { name: /Unlock/i }).click();
      await expect(h.page.locator('.sidebar')).toBeVisible({ timeout: 15_000 });
    } finally {
      await h.close();
    }
  });
});
