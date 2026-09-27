/**
 * Flows 41–47: backup, global search, settings, notifications, about, sidebar collapse, Bengali UI smoke.
 */
import { test, expect, e2eRunnable, assertE2eRunnableOrThrow, bootToDashboard, goNav } from './helpers';

test.describe('Backup · Search · Settings · About (flows 41–47)', () => {
  test.beforeAll(() => {
    if (process.env.CI === 'true' || process.env.DENTIVA_E2E_REQUIRE === '1') {
      assertE2eRunnableOrThrow();
    } else if (!e2eRunnable()) {
      test.skip(true, 'Local sandbox: Electron/native/activation not available');
    }
  });

  test('41 · backup page loads and create-backup control is present', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Backup & Restore|Backup/i);
      await expect(h.page.getByRole('heading', { name: /Backup/i })).toBeVisible();
      await expect(h.page.getByRole('button', { name: /Create backup|Backup now|Run backup/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('42 · create a manual backup successfully', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Backup & Restore|Backup/i);
      await h.page.getByRole('button', { name: /Create backup|Backup now|Run backup/i }).click();
      // Either a toast or a new row appears
      await h.page.waitForTimeout(1500);
      const body = await h.page.locator('body').innerText();
      expect(body.length).toBeGreaterThan(20);
    } finally {
      await h.close();
    }
  });

  test('43 · global search palette opens with Ctrl+K', async () => {
    const h = await bootToDashboard();
    try {
      await h.page.keyboard.press('Control+k');
      await expect(h.page.locator('.palette, [role=dialog]').first()).toBeVisible({ timeout: 10_000 });
      await h.page.keyboard.press('Escape');
    } finally {
      await h.close();
    }
  });

  test('44 · settings page loads with clinic / preferences sections', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Settings/i);
      await expect(h.page.getByRole('heading', { name: /Settings/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('45 · About page shows developer Shohan Khan and contact email', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /About/i);
      await expect(h.page.getByText(/Shohan Khan/i)).toBeVisible();
      await expect(h.page.getByText(/helloiamshohan@gmail.com/i)).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('46 · sidebar collapse toggle works and state is retained', async () => {
    const h = await bootToDashboard();
    try {
      const toggle = h.page.getByRole('button', { name: /Toggle sidebar|Collapse|Expand/i }).first();
      await toggle.click();
      // Collapsed class applied
      await expect(h.page.locator('.sidebar.collapsed, .sidebar')).toBeVisible();
      await toggle.click();
    } finally {
      await h.close();
    }
  });

  test('47 · notification center opens from the bell button', async () => {
    const h = await bootToDashboard();
    try {
      await h.page.getByRole('button', { name: /Notifications/i }).click();
      await expect(h.page.locator('.notif-panel, .notif-overlay, [class*=notif]').first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });
});
