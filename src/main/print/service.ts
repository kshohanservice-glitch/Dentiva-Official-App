/**
 * Print & PDF pipeline.
 *
 * Documents are built as HTML by ./templates, loaded into a hidden BrowserWindow
 * (Chromium layout engine), then sent to a printer via webContents.print() or
 * exported as vector PDF via webContents.printToPDF(). Bengali fonts are embedded
 * from bundled woff2 files, so paper output matches screen output exactly.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { sessionManager } from '../services/session';
import { audit } from '../services/audit';
import { logger } from '../util/logger';
import {
  accountingReportHtml,
  invoiceHtml,
  prescriptionHtml,
  receiptHtml,
  PAPER_SIZES,
  type PaperProfile,
} from './templates';

export interface PrintOptions {
  silent?: boolean;
  printerName?: string;
  copies?: number;
}

interface RenderHandle {
  win: BrowserWindow;
  dispose: () => void;
}

/** Render an HTML document into a hidden window and wait for layout + fonts. */
async function render(html: string): Promise<RenderHandle> {
  const win = new BrowserWindow({
    show: false,
    width: 860,
    height: 1100,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Load from a temp file so file:// font URLs resolve without origin restrictions.
  const tmp = path.join(os.tmpdir(), `dentiva-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');

  const dispose = () => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    if (!win.isDestroyed()) win.destroy();
  };

  try {
    await win.loadFile(tmp);
    // Wait for font loading so Bengali glyphs are shaped before rasterization.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)').catch(() => true);
    return { win, dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}

function paperMicrons(paper: PaperProfile): { width: number; height: number } {
  const mmToMicrons = (mm: number) => Math.round(mm * 1000);
  const p = PAPER_SIZES[paper];
  const parseMm = (v: string): number => parseFloat(v);
  const width = mmToMicrons(parseMm(p.width));
  const height = p.height === 'auto' ? mmToMicrons(297) : mmToMicrons(parseMm(p.height));
  return { width, height };
}

function paperInches(paper: PaperProfile): { width: number; height: number } {
  const m = paperMicrons(paper);
  return { width: m.width / 25400, height: m.height / 25400 };
}

/** Print a rendered document to a printer (system dialog unless silent). */
async function printToPrinter(html: string, paper: PaperProfile, opts: PrintOptions): Promise<void> {
  const handle = await render(html);
  try {
    const { width, height } = paperMicrons(paper);
    await new Promise<void>((resolve, reject) => {
      handle.win.webContents.print(
        {
          silent: opts.silent ?? false,
          deviceName: opts.printerName ?? '',
          copies: opts.copies ?? 1,
          pageSize: { width, height },
          margins: { marginType: 'none' },
          printBackground: true,
        },
        (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(failureReason || 'Print failed.'));
        },
      );
    });
  } finally {
    handle.dispose();
  }
}

/** Export a rendered document as PDF; returns the PDF bytes. */
async function renderPdf(html: string, paper: PaperProfile): Promise<Buffer> {
  const handle = await render(html);
  try {
    const { width, height } = paperInches(paper);
    return await handle.win.webContents.printToPDF({
      pageSize: { width, height },
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      displayHeaderFooter: false,
      preferCSSPageSize: false,
    });
  } finally {
    handle.dispose();
  }
}

/** Print → PDF, then ask the user where to save it. Returns the saved path or null. */
async function savePdfDialog(html: string, paper: PaperProfile, defaultName: string): Promise<string | null> {
  const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const res = await dialog.showSaveDialog(focused, {
    title: 'Save PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const bytes = await renderPdf(html, paper);
  fs.writeFileSync(res.filePath, bytes);
  return res.filePath;
}

export async function listPrinters(): Promise<Array<{ name: string; isDefault: boolean }>> {
  // Any authenticated, unlocked session may list printers (needed to populate print dialogs).
  sessionManager.currentUser();
  const scratch = new BrowserWindow({ show: false, width: 100, height: 100, webPreferences: { offscreen: false } });
  try {
    await scratch.loadURL('about:blank');
    const printers = await scratch.webContents.getPrintersAsync();
    return printers.map((p) => ({ name: p.name, isDefault: p.isDefault }));
  } finally {
    if (!scratch.isDestroyed()) scratch.destroy();
  }
}

/* ------------------------- Permission-gated entry points ------------------------- */

export async function printPrescription(id: number, opts: PrintOptions, paper: PaperProfile = 'a4'): Promise<void> {
  sessionManager.ensurePermission('prescriptions.print');
  const html = prescriptionHtml(id, paper);
  await printToPrinter(html, paper, opts);
  audit({ action: 'print.prescription', entity: 'prescription', entityId: id });
  logger.info(`Printed prescription ${id}`);
}

export async function printInvoice(id: number, opts: PrintOptions, paper: PaperProfile = 'a4'): Promise<void> {
  sessionManager.ensurePermission('invoices.print');
  const html = invoiceHtml(id, paper);
  await printToPrinter(html, paper, opts);
  audit({ action: 'print.invoice', entity: 'invoice', entityId: id });
  logger.info(`Printed invoice ${id}`);
}

export async function printReceipt(paymentId: number, opts: PrintOptions, paper: PaperProfile = 'thermal80'): Promise<void> {
  sessionManager.ensurePermission('invoices.print');
  const html = receiptHtml(paymentId, paper);
  await printToPrinter(html, paper, opts);
  audit({ action: 'print.receipt', entity: 'payment', entityId: paymentId });
  logger.info(`Printed receipt for payment ${paymentId}`);
}

export async function printAccountingReport(from: string, to: string, opts: PrintOptions, paper: PaperProfile = 'a4'): Promise<void> {
  sessionManager.ensurePermission('reports.print');
  const html = accountingReportHtml(from, to, paper);
  await printToPrinter(html, paper, opts);
  audit({ action: 'print.report', entity: 'report', details: { from, to } });
  logger.info(`Printed accounting report ${from}..${to}`);
}

/* ------------------------------- PDF variants ------------------------------- */

export async function savePrescriptionPdf(id: number, defaultName: string): Promise<string | null> {
  sessionManager.ensurePermission('prescriptions.print');
  const saved = await savePdfDialog(prescriptionHtml(id, 'a4'), 'a4', defaultName);
  if (saved) audit({ action: 'pdf.prescription', entity: 'prescription', entityId: id, details: { path: saved } });
  return saved;
}

export async function saveInvoicePdf(id: number, defaultName: string): Promise<string | null> {
  sessionManager.ensurePermission('invoices.print');
  const saved = await savePdfDialog(invoiceHtml(id, 'a4'), 'a4', defaultName);
  if (saved) audit({ action: 'pdf.invoice', entity: 'invoice', entityId: id, details: { path: saved } });
  return saved;
}

export async function saveReceiptPdf(paymentId: number, defaultName: string): Promise<string | null> {
  sessionManager.ensurePermission('invoices.print');
  const saved = await savePdfDialog(receiptHtml(paymentId, 'a5'), 'a5', defaultName);
  if (saved) audit({ action: 'pdf.receipt', entity: 'payment', entityId: paymentId, details: { path: saved } });
  return saved;
}

export async function saveAccountingReportPdf(from: string, to: string, defaultName: string): Promise<string | null> {
  sessionManager.ensurePermission('reports.print');
  const saved = await savePdfDialog(accountingReportHtml(from, to, 'a4'), 'a4', defaultName);
  if (saved) audit({ action: 'pdf.report', entity: 'report', details: { from, to, path: saved } });
  return saved;
}
