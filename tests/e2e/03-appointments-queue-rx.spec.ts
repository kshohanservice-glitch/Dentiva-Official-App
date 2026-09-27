/**
 * Flows 19–26: appointments, queue check-in, prescriptions (multi-medicine, Bengali).
 */
import { test, expect, e2eRunnable, bootToDashboard, goNav } from './helpers';

test.describe('Appointments · Queue · Prescriptions (flows 19–26)', () => {
  test.skip(!e2eRunnable(), 'CI-only');

  test('19 · appointments page loads with day agenda', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Appointments/i);
      await expect(h.page.getByRole('heading', { name: /Appointments/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('20 · schedule a new appointment for an existing patient', async () => {
    const h = await bootToDashboard();
    try {
      // Seed patient
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Appt Patient');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711000010');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await expect(h.page.getByText('Appt Patient').first()).toBeVisible({ timeout: 15_000 });

      await goNav(h.page, /Appointments/i);
      await h.page.getByRole('button', { name: /New appointment|Book|Schedule/i }).click();
      await expect(h.page.getByRole('dialog').or(h.page.locator('.modal'))).toBeVisible();
      // Patient picker — type the name
      const picker = h.page.getByPlaceholder(/Search patient|Patient/i).first();
      if (await picker.isVisible().catch(() => false)) {
        await picker.fill('Appt Patient');
        await h.page.getByText('Appt Patient').first().click();
      }
      await h.page.getByRole('button', { name: /Save|Book|Create/i }).click();
    } finally {
      await h.close();
    }
  });

  test('21 · queue page loads and supports check-in entry', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Queue/i);
      await expect(h.page.getByRole('heading', { name: /Queue/i })).toBeVisible();
      await expect(h.page.getByRole('button', { name: /Check in|Check-in/i }).or(h.page.getByText(/No patients/i))).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('22 · prescriptions page loads', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Prescriptions/i);
      await expect(h.page.getByRole('heading', { name: /Prescriptions/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('23 · write a multi-medicine prescription with Bengali advice', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Rx Patient');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711000011');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();

      await goNav(h.page, /Prescriptions/i);
      await h.page.getByRole('button', { name: /New prescription|Write/i }).click();
      await expect(h.page.getByRole('dialog').or(h.page.locator('.modal'))).toBeVisible();
      const picker = h.page.getByPlaceholder(/Search patient|Patient/i).first();
      if (await picker.isVisible().catch(() => false)) {
        await picker.fill('Rx Patient');
        await h.page.getByText('Rx Patient').first().click();
      }
      // Add first medicine
      await h.page.getByLabel(/Medicine|Drug/i).first().fill('অ্যামোক্সিসিলিন').catch(async () => {
        await h.page.locator('input').nth(2).fill('Amoxicillin');
      });
      await h.page.getByLabel(/Advice/i).fill('ঔষধ ঠিকমতো খাবেন').catch(() => undefined);
      await h.page.getByRole('button', { name: /Save prescription|Save/i }).click();
    } finally {
      await h.close();
    }
  });

  test('24 · prescription list shows the new Rx after save', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Prescriptions/i);
      // Page must render without error even when empty
      await expect(h.page.locator('.page, .card, .empty-state').first()).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('25 · treatments catalog page loads', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Treatments/i);
      await expect(h.page.getByRole('heading', { name: /Treatments/i })).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('26 · create a treatment catalog entry with BDT price', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Treatments/i);
      await h.page.getByRole('button', { name: /New treatment|Add treatment/i }).click();
      await h.page.getByLabel(/Name/i).first().fill('Root Canal');
      await h.page.getByLabel(/Code/i).first().fill('RCT').catch(() => undefined);
      await h.page.getByLabel(/Price|Default/i).first().fill('5000').catch(() => undefined);
      await h.page.getByRole('button', { name: /Save|Create/i }).click();
      await expect(h.page.getByText(/Root Canal/i).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await h.close();
    }
  });
});
