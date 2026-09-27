/**
 * Print document templates.
 *
 * Every document is rendered as semantic HTML+CSS against the bundled fonts
 * (Inter + Noto Sans Bengali) so Bengali shaping is correct on paper and in PDF.
 * A single layout engine serves print and PDF; paper profiles adapt via CSS vars.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb } from '../db/connection';
import { getClinicForHeader } from '../services/dentists';
import { accountingReport } from '../services/accounting';
import { formatBDT } from '../../shared/money';
import { NotFoundError } from '../util/errors';

export type PaperProfile = 'a4' | 'a5' | 'thermal80' | 'mini';

export const PAPER_SIZES: Record<PaperProfile, { width: string; height: string; margin: string; label: string }> = {
  a4: { width: '210mm', height: '297mm', margin: '14mm', label: 'A4' },
  a5: { width: '148mm', height: '210mm', margin: '10mm', label: 'A5' },
  thermal80: { width: '80mm', height: 'auto', margin: '4mm', label: 'Thermal 80mm' },
  mini: { width: '101.6mm', height: '152.4mm', margin: '6mm', label: '4×6 in' },
};

/** Directory that holds the bundled woff2 fonts (packaged resources or repo). */
export function fontsDir(): string {
  // app.isPackaged -> process.resourcesPath/resources; dev -> repo resources/
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    if (app.isPackaged) return path.join(process.resourcesPath, 'fonts');
  } catch {
    /* plain Node (tests) — fall through */
  }
  return path.join(__dirname, '..', '..', '..', 'resources', 'fonts');
}

function fontFace(name: string, file: string, weight: number): string {
  const url = pathToFileURL(path.join(fontsDir(), file)).href;
  return `@font-face { font-family: '${name}'; src: url('${url}') format('woff2'); font-weight: ${weight}; font-style: normal; }`;
}

function baseCss(paper: PaperProfile): string {
  const p = PAPER_SIZES[paper];
  const bengali = [400, 500, 600, 700].map((w) => fontFace('Noto Sans Bengali', `NotoSansBengali-${w}.woff2`, w)).join('\n');
  const latin = [400, 500, 600, 700].map((w) => fontFace('Inter', `Inter-${w}.woff2`, w)).join('\n');
  return `
    ${bengali}
    ${latin}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Inter', 'Noto Sans Bengali', system-ui, sans-serif;
      color: #10233a; font-size: 12px; line-height: 1.45;
      width: ${p.width}; min-height: ${p.height === 'auto' ? '0' : p.height};
      padding: ${p.margin};
    }
    h1,h2,h3 { margin: 0; }
    table { border-collapse: collapse; width: 100%; }
    .mono { font-variant-numeric: tabular-nums; }
    .muted { color: #5b6b7f; }
    .right { text-align: right; }
    .center { text-align: center; }
    .strong { font-weight: 600; }
    .divider { border-bottom: 1px solid #c7d2e0; margin: 8px 0; }
    .thick { border-bottom: 2px solid #10233a; margin: 8px 0; }
    @page { size: ${p.width} ${p.height === 'auto' ? 'auto' : p.height}; margin: 0; }
  `;
}

function wrap(title: string, paper: PaperProfile, body: string): string {
  return `<!doctype html>
<html lang="bn"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>${baseCss(paper)}</style></head>
<body>${body}</body></html>`;
}

export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clinicHeader(): string {
  const c = getClinicForHeader() ?? { name: '', address: '', phone: '', tagline: '' };
  return `
    <div class="center" style="margin-bottom:6px;">
      <div style="font-size:20px;font-weight:700;">${escapeHtml(c.name || 'Dentiva Pro')}</div>
      ${c.tagline ? `<div class="muted" style="font-size:11px;">${escapeHtml(c.tagline)}</div>` : ''}
      <div class="muted" style="font-size:11px;">${[c.address, c.phone].filter((x): x is string => Boolean(x)).map(escapeHtml).join(' · ')}</div>
    </div>
  `;
}

/* ---------------------------- Prescription ---------------------------- */

export function prescriptionHtml(id: number, paper: PaperProfile = 'a4'): string {
  const db = getDb();
  const rx = db
    .prepare(
      `SELECT p.*, pt.full_name AS patient_name, pt.patient_code, pt.age, pt.gender, pt.phone,
              d.full_name AS dentist_name, d.title AS dentist_title, d.designations AS dentist_designations, d.registration_no
       FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id LEFT JOIN dentists d ON d.id = p.dentist_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get<Record<string, string | number | null>>(id);
  if (!rx) throw new NotFoundError('Prescription');
  const items = db.prepare('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order ASC').all<Record<string, string | number>>(id);

  const itemRows = items
    .map((it, i) => {
      const timing = [it.morning ? 'সকাল' : '', it.noon ? 'দুপুর' : '', it.night ? 'রাত' : ''].filter(Boolean).join(' + ');
      const food = it.before_food ? 'খাবারের আগে' : it.after_food ? 'খাবারের পরে' : '';
      const dose = it.prn ? 'প্রয়োজনে' : `${it.dose || ''}${timing ? ' — ' + timing : ''}`.trim();
      return `<tr>
        <td style="padding:6px 4px;vertical-align:top;">${i + 1}.</td>
        <td style="padding:6px 4px;vertical-align:top;">
          <div class="strong" style="font-size:13px;">${escapeHtml(String(it.medicine_name))}${it.strength ? ` <span class="muted">${escapeHtml(String(it.strength))}</span>` : ''} <span class="muted">(${escapeHtml(String(it.form))})</span></div>
          <div class="muted" style="font-size:11px;">${escapeHtml([dose, food, it.duration ? `মেয়াদ: ${it.duration}` : '', it.instructions].filter(Boolean).join(' · '))}</div>
        </td>
      </tr>`;
    })
    .join('');

  const body = `
    ${clinicHeader()}
    <div class="thick"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px;">
      <div>
        <div style="font-size:16px;font-weight:700;">${escapeHtml(String(rx.dentist_name || 'Dentist'))}</div>
        ${rx.dentist_title || rx.dentist_designations ? `<div class="muted" style="font-size:11px;">${escapeHtml([rx.dentist_title, rx.dentist_designations].filter(Boolean).join(', '))}</div>` : ''}
        ${rx.registration_no ? `<div class="muted" style="font-size:11px;">Reg: ${escapeHtml(String(rx.registration_no))}</div>` : ''}
      </div>
      <div class="right">
        <div class="strong">Rx — ${escapeHtml(String(rx.rx_no))}</div>
        <div class="muted" style="font-size:11px;">${escapeHtml(String(rx.created_at))}</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:12px;">
      <div><span class="muted">রোগী:</span> <span class="strong">${escapeHtml(String(rx.patient_name))}</span> <span class="muted">(${escapeHtml(String(rx.patient_code))})</span></div>
      <div><span class="muted">বয়স/লিঙ্গ:</span> ${rx.age ?? '—'}${rx.gender ? ' / ' + escapeHtml(String(rx.gender)) : ''}</div>
    </div>
    ${rx.chief_complaint || rx.on_examination ? `<div style="margin-bottom:8px;font-size:11.5px;">
      ${rx.chief_complaint ? `<div><span class="muted">C/C:</span> ${escapeHtml(String(rx.chief_complaint))}</div>` : ''}
      ${rx.on_examination ? `<div><span class="muted">O/E:</span> ${escapeHtml(String(rx.on_examination))}</div>` : ''}
    </div>` : ''}
    <table>${itemRows}</table>
    ${rx.advice ? `<div style="margin-top:10px;"><span class="muted">উপদেশ:</span> ${escapeHtml(String(rx.advice))}</div>` : ''}
    <div style="margin-top:34px;display:flex;justify-content:flex-end;">
      <div class="center" style="width:180px;border-top:1px solid #10233a;padding-top:4px;">
        <div class="strong">${escapeHtml(String(rx.dentist_name || 'Signature'))}</div>
        <div class="muted" style="font-size:11px;">Signature</div>
      </div>
    </div>
  `;
  return wrap(`Prescription ${rx.rx_no}`, paper, body);
}

/* ------------------------------ Invoice ------------------------------- */

export function invoiceHtml(id: number, paper: PaperProfile = 'a4'): string {
  const db = getDb();
  const inv = db
    .prepare(
      `SELECT i.*, pt.full_name AS patient_name, pt.patient_code, pt.phone, pt.address
       FROM invoices i JOIN patients pt ON pt.id = i.patient_id WHERE i.id = ? AND i.deleted_at IS NULL`,
    )
    .get<Record<string, string | number | null>>(id);
  if (!inv) throw new NotFoundError('Invoice');
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC').all<Record<string, string | number>>(id);

  const rows = items
    .map(
      (it, i) => `<tr>
        <td style="padding:5px 4px;">${i + 1}</td>
        <td style="padding:5px 4px;">${escapeHtml(String(it.description))}</td>
        <td class="right" style="padding:5px 4px;">${it.quantity}</td>
        <td class="right mono" style="padding:5px 4px;">${formatBDT(Number(it.unit_price_paisa))}</td>
        <td class="right mono" style="padding:5px 4px;">${formatBDT(Number(it.line_total_paisa))}</td>
      </tr>`,
    )
    .join('');

  const outstanding = Number(inv.grand_total_paisa) - Number(inv.paid_paisa);
  const body = `
    ${clinicHeader()}
    <div class="thick"></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
      <div>
        <div class="strong" style="font-size:14px;">Invoice</div>
        <div class="muted" style="font-size:11px;">${escapeHtml(String(inv.invoice_no))} · ${escapeHtml(String(inv.invoice_date))}</div>
      </div>
      <div class="right">
        <div class="strong">${escapeHtml(String(inv.patient_name))}</div>
        <div class="muted" style="font-size:11px;">${escapeHtml(String(inv.patient_code))}${inv.phone ? ' · ' + escapeHtml(String(inv.phone)) : ''}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr style="border-bottom:1px solid #c7d2e0;">
          <th style="text-align:left;padding:5px 4px;">#</th>
          <th style="text-align:left;padding:5px 4px;">Description</th>
          <th class="right" style="padding:5px 4px;">Qty</th>
          <th class="right" style="padding:5px 4px;">Unit price</th>
          <th class="right" style="padding:5px 4px;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="divider"></div>
    <table style="width:300px;margin-left:auto;">
      <tr><td class="muted" style="padding:2px 4px;">Subtotal</td><td class="right mono" style="padding:2px 4px;">${formatBDT(Number(inv.subtotal_paisa))}</td></tr>
      ${Number(inv.discount_paisa) > 0 ? `<tr><td class="muted" style="padding:2px 4px;">Discount</td><td class="right mono" style="padding:2px 4px;">− ${formatBDT(Number(inv.discount_paisa))}</td></tr>` : ''}
      ${Number(inv.tax_paisa) > 0 ? `<tr><td class="muted" style="padding:2px 4px;">Tax</td><td class="right mono" style="padding:2px 4px;">${formatBDT(Number(inv.tax_paisa))}</td></tr>` : ''}
      <tr><td class="strong" style="padding:4px;">Grand total</td><td class="right strong mono" style="padding:4px;">${formatBDT(Number(inv.grand_total_paisa))}</td></tr>
      <tr><td class="muted" style="padding:2px 4px;">Paid</td><td class="right mono" style="padding:2px 4px;">${formatBDT(Number(inv.paid_paisa))}</td></tr>
      <tr><td class="strong" style="padding:2px 4px;">Outstanding</td><td class="right strong mono" style="padding:2px 4px;">${formatBDT(outstanding)}</td></tr>
    </table>
    ${inv.notes ? `<div class="muted" style="margin-top:10px;font-size:11px;">${escapeHtml(String(inv.notes))}</div>` : ''}
  `;
  return wrap(`Invoice ${inv.invoice_no}`, paper, body);
}

/* ------------------------------ Receipt ------------------------------- */

export function receiptHtml(paymentId: number, paper: PaperProfile = 'thermal80'): string {
  const db = getDb();
  const p = db
    .prepare(
      `SELECT p.*, pm.name AS method_name, pt.full_name AS patient_name, i.invoice_no
       FROM payments p JOIN payment_methods pm ON pm.id = p.method_id JOIN patients pt ON pt.id = p.patient_id LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.id = ?`,
    )
    .get<Record<string, string | number | null>>(paymentId);
  if (!p) throw new NotFoundError('Payment');

  const body = `
    ${clinicHeader()}
    <div class="thick"></div>
    <div class="center" style="margin-bottom:6px;">
      <div class="strong" style="font-size:14px;">Payment Receipt</div>
      <div class="muted" style="font-size:11px;">${escapeHtml(String(p.receipt_no))}</div>
    </div>
    <table>
      <tr><td class="muted" style="padding:3px 4px;">Date</td><td class="right" style="padding:3px 4px;">${escapeHtml(String(p.paid_at))}</td></tr>
      <tr><td class="muted" style="padding:3px 4px;">Patient</td><td class="right" style="padding:3px 4px;">${escapeHtml(String(p.patient_name))}</td></tr>
      ${p.invoice_no ? `<tr><td class="muted" style="padding:3px 4px;">Invoice</td><td class="right" style="padding:3px 4px;">${escapeHtml(String(p.invoice_no))}</td></tr>` : ''}
      <tr><td class="muted" style="padding:3px 4px;">Method</td><td class="right" style="padding:3px 4px;">${escapeHtml(String(p.method_name))}</td></tr>
      ${p.reference ? `<tr><td class="muted" style="padding:3px 4px;">Reference</td><td class="right" style="padding:3px 4px;">${escapeHtml(String(p.reference))}</td></tr>` : ''}
    </table>
    <div class="divider"></div>
    <table>
      <tr>
        <td class="strong" style="font-size:14px;padding:4px;">Amount received</td>
        <td class="right strong mono" style="font-size:14px;padding:4px;">${formatBDT(Number(p.amount_paisa))}</td>
      </tr>
    </table>
    <div class="center muted" style="margin-top:10px;font-size:10px;">ধন্যবাদ — Thank you</div>
  `;
  return wrap(`Receipt ${p.receipt_no}`, paper, body);
}

/* ---------------------------- Accounting report ---------------------------- */

export function accountingReportHtml(from: string, to: string, paper: PaperProfile = 'a4'): string {
  const r = accountingReport({ from, to }) as unknown as {
    treatmentIncomePaisa: number;
    otherIncomePaisa: number;
    totalIncomePaisa: number;
    totalExpensePaisa: number;
    netIncomePaisa: number;
    invoicedPaisa: number;
    outstandingPaisa: number;
    expenseByCategory: Array<{ category: string; total: number }>;
    incomeByCategory: Array<{ category: string; total: number }>;
  };

  const expenseRows = r.expenseByCategory
    .map((c) => `<tr><td style="padding:4px;">${escapeHtml(c.category)}</td><td class="right mono" style="padding:4px;">${formatBDT(c.total)}</td></tr>`)
    .join('');
  const incomeRows = r.incomeByCategory
    .map((c) => `<tr><td style="padding:4px;">${escapeHtml(c.category)}</td><td class="right mono" style="padding:4px;">${formatBDT(c.total)}</td></tr>`)
    .join('');

  const body = `
    ${clinicHeader()}
    <div class="thick"></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
      <div class="strong" style="font-size:14px;">Accounting Report</div>
      <div class="muted">${escapeHtml(from)} → ${escapeHtml(to)}</div>
    </div>
    <table>
      <tr><td class="muted" style="padding:4px;">Treatment income (payments)</td><td class="right mono" style="padding:4px;">${formatBDT(r.treatmentIncomePaisa)}</td></tr>
      <tr><td class="muted" style="padding:4px;">Other income</td><td class="right mono" style="padding:4px;">${formatBDT(r.otherIncomePaisa)}</td></tr>
      <tr><td class="strong" style="padding:4px;">Total income</td><td class="right strong mono" style="padding:4px;">${formatBDT(r.totalIncomePaisa)}</td></tr>
      <tr><td class="strong" style="padding:4px;">Total expenses</td><td class="right strong mono" style="padding:4px;">${formatBDT(r.totalExpensePaisa)}</td></tr>
      <tr><td class="strong" style="padding:6px;border-top:2px solid #10233a;">Net income</td><td class="right strong mono" style="padding:6px;border-top:2px solid #10233a;">${formatBDT(r.netIncomePaisa)}</td></tr>
      <tr><td class="muted" style="padding:4px;">Invoiced</td><td class="right mono" style="padding:4px;">${formatBDT(r.invoicedPaisa)}</td></tr>
      <tr><td class="muted" style="padding:4px;">Outstanding receivables</td><td class="right mono" style="padding:4px;">${formatBDT(r.outstandingPaisa)}</td></tr>
    </table>
    ${incomeRows ? `<h3 style="margin-top:14px;">Income by category</h3><table>${incomeRows}</table>` : ''}
    ${expenseRows ? `<h3 style="margin-top:14px;">Expenses by category</h3><table>${expenseRows}</table>` : ''}
  `;
  return wrap('Accounting report', paper, body);
}
