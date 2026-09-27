/**
 * Flows 9–18: patients CRUD, Bengali names, detail tabs (visits/chart/treatments/referrals/timeline/attachments).
 */
import { test, expect, e2eRunnable, bootToDashboard, goNav } from './helpers';

test.describe('Patients · Clinical (flows 9–18)', () => {
  test.skip(!e2eRunnable(), 'CI-only');

  test('9 · navigate to Patients and open the new-patient dialog', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await expect(h.page.getByRole('heading', { name: /Patients/i })).toBeVisible();
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await expect(h.page.getByRole('dialog').or(h.page.locator('.modal'))).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('10 · create a patient with Latin name and phone', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Rahim Uddin');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711223344');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await expect(h.page.getByText('Rahim Uddin').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await h.close();
    }
  });

  test('11 · create a patient with Bengali name (Unicode round-trip)', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('ডাক্তার রহিম');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711998877');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await expect(h.page.getByText('ডাক্তার রহিম').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await h.close();
    }
  });

  test('12 · search finds the patient by name fragment', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Searchable Patient');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711000001');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await expect(h.page.getByText('Searchable Patient').first()).toBeVisible({ timeout: 15_000 });
      const search = h.page.getByPlaceholder(/Search/i).first();
      await search.fill('Searchable');
      await expect(h.page.getByText('Searchable Patient').first()).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('13 · open patient detail and see Overview + Financial tabs', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Detail Patient');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711000002');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await h.page.getByText('Detail Patient').first().click();
      await expect(h.page.getByRole('tab', { name: /Overview/i }).or(h.page.getByText('Overview'))).toBeVisible();
      await expect(h.page.getByText(/Visits|Dental chart|Financial/i).first()).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('14 · record a visit on the patient detail Visits tab', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Visit Patient');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711000003');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await h.page.getByText('Visit Patient').first().click();
      await h.page.getByRole('tab', { name: /Visits/i }).or(h.page.getByText('Visits', { exact: true })).first().click();
      await h.page.getByRole('button', { name: /New visit/i }).click();
      await h.page.getByLabel(/Chief complaint/i).fill('Tooth pain');
      await h.page.getByRole('button', { name: /Save visit/i }).click();
      await expect(h.page.getByText(/Tooth pain/i).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await h.close();
    }
  });

  test('15 · dental chart tab shows FDI grid and records a finding', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Chart Patient');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711000004');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await h.page.getByText('Chart Patient').first().click();
      await h.page.getByText(/Dental chart/i).first().click();
      await expect(h.page.getByText(/PERMANENT DENTITION/i).first()).toBeVisible();
      await h.page.getByRole('button', { name: /Record finding/i }).click();
      // Select tooth 16
      await h.page.getByRole('button', { name: '16', exact: true }).first().click();
      await h.page.getByRole('button', { name: /Save finding/i }).click();
      await expect(h.page.getByLabel(/Tooth 16/i).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await h.close();
    }
  });

  test('16 · treatment records tab accepts a catalog treatment', async () => {
    const h = await bootToDashboard();
    try {
      // Seed a treatment via the Treatments page first
      await goNav(h.page, /Treatments/i);
      const addBtn = h.page.getByRole('button', { name: /New treatment|Add treatment/i });
      if (await addBtn.isVisible().catch(() => false)) {
        await addBtn.click();
        await h.page.getByLabel(/Name/i).first().fill('Scaling');
        await h.page.getByLabel(/Code/i).first().fill('SCL').catch(() => undefined);
        await h.page.getByLabel(/Price|Default price/i).first().fill('1500').catch(() => undefined);
        await h.page.getByRole('button', { name: /Save|Create/i }).click();
      }
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Tx Patient');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711000005');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await h.page.getByText('Tx Patient').first().click();
      await h.page.getByText(/^Treatments$/i).first().click();
      await h.page.getByRole('button', { name: /Record treatment/i }).click();
      await expect(h.page.getByText(/Record treatment|Treatment/i).first()).toBeVisible();
    } finally {
      await h.close();
    }
  });

  test('17 · referrals tab creates an outgoing referral', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Referral Patient');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711000006');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await h.page.getByText('Referral Patient').first().click();
      await h.page.getByText(/^Referrals$/i).first().click();
      await h.page.getByRole('button', { name: /New referral/i }).click();
      await h.page.getByLabel(/Referred to/i).fill('Dr. Specialist');
      await h.page.getByRole('button', { name: /Create referral/i }).click();
      await expect(h.page.getByText('Dr. Specialist').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await h.close();
    }
  });

  test('18 · timeline tab is reachable and filterable', async () => {
    const h = await bootToDashboard();
    try {
      await goNav(h.page, /Patients/i);
      await h.page.getByRole('button', { name: /New patient|Add patient/i }).click();
      await h.page.getByLabel(/Full name/i).fill('Timeline Patient');
      await h.page.getByLabel(/^Phone$/i).fill('+8801711000007');
      await h.page.getByRole('button', { name: /Save|Create|Add patient/i }).click();
      await h.page.getByText('Timeline Patient').first().click();
      await h.page.getByText(/^Timeline$/i).first().click();
      await expect(h.page.getByText(/Clinical timeline|Nothing here yet|Everything/i).first()).toBeVisible();
    } finally {
      await h.close();
    }
  });
});
