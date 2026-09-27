import { defineConfig } from '@playwright/test';

/**
 * E2E config for Dentiva Pro (Playwright `_electron`).
 *
 * On CI we set `forbidOnly` and treat unexpected skips as failures via the
 * workflow step that asserts 47 passed / 0 skipped after the run.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
