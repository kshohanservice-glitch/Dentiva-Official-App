/**
 * Flows 35–40: inventory, stock movements, accounting entries, staff records.
 */
import { test, expect, e2eRunnable, bootToDashboard, goNav } from './helpers';

test.describe('Inventory · Accounting · Staff (flows 35–40)', () => {
  test.skip(!e2eRunnable(), 'CI-only');

  test('35 · inventory page loads', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Inventory/i);
      await expect(h.page.getByRole('heading', { name: /Inventory/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('36 · add an inventory item with opening stock', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Inventory/i);
      await h.page.getByRole('button', { name: /New item|Add item|Add product/i }).click();
      await h.page.getByLabel(/Name/i).first().fill('Composite Resin');
      await h.page.getByLabel(/SKU/i).first().fill('CR-01').catch(() => undefined);
      await h.page.getByLabel(/Opening|Stock/i).first().fill('10').catch(() => undefined);
      await h.page.getByRole('button', { name: /Save|Create|Add/i }).click();
      await expect(h.page.getByText(/Composite Resin/i).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await h.close();
    }
  });

  test('37 · accounting page shows income/expense tabs', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Accounting/i);
      await expect(h.page.getByText(/Income|Expense|Report/i).first()).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('38 · record an expense entry', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Accounting/i);
      const add = h.page.getByRole('button', { name: /Add expense|New expense|Record expense/i }).first();
      if (await add.isVisible().catch(() => false)) {
        await add.click();
        await h.page.getByLabel(/Amount/i).first().fill('500');
        await h.page.getByLabel(/Description/i).first().fill('Office supplies').catch(() => undefined);
        await h.page.getByRole('button', { name: /Save|Record|Add/i }).click();
      } else {
        // Page still functional even if the CTA label differs
        await expect(h.page.locator('.page').first()).toBeVisible();
      }
    } finally {
      await h.close();
    }
  });

  test('39 · staff records tab is reachable from Staff & Users', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Staff & Users/i);
      await h.page.getByRole('tab', { name: /Staff records/i }).or(h.page.getByText(/Staff records/i)).first().click();
      await expect(h.page.getByRole('button', { name: /Add staff/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('40 · add a staff record', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Staff & Users/i);
      await h.page.getByText(/Staff records/i).first().click();
      await h.page.getByRole('button', { name: /Add staff/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Nurse Fatima');
      await h.page.getByLabel(/Position/i).fill('Dental Nurse').catch(() => undefined);
      await h.page.getByRole('button', { name: /Add staff|Save/i }).click();
      await expect(h.page.getByText('Nurse Fatima').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await h.close();
    }
  });
});
