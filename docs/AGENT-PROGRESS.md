# Dentiva Pro — Agent Progress Tracker

> Continuity document (master prompt §114). Updated at the end of every work session.

## Current phase

**Phase 13–20 in progress** — application feature set is implemented; remaining work is packaging verification on Windows CI, full E2E execution on CI (Electron binary unavailable in this sandbox), and final audit docs polish.

## Branch & commits

- Branch: `arena/01a0e35f-dentiva-official-app`
- Latest commits (most recent first):
  - print/PDF pipeline + Bengali fonts + 7 template tests
  - staff records tab
  - patient clinical record tabs
  - module pages + global search + notifications
  - services + integration tests (77 → 84)

## Completed

### Foundation
- [x] `docs/MASTER-IMPLEMENTATION-PLAN.md` (31 sections + decision log)
- [x] Tooling: package.json, tsconfig, vite, esbuild main/preload, eslint flat, vitest, playwright, electron-builder NSIS
- [x] Shared modules: money (paisa INTEGER + formatBDT), permissions (RBAC catalog + ROLE_DEFAULTS), datetime
- [x] SQLite schema (43 tables), driver (better-sqlite3 + node:sqlite fallback), seed, integrity check
- [x] Activation verifier (scrypt-derived SHIPPED_VERIFIER; plaintext code never committed)
- [x] scrypt password hashing, session lock, audit log, settings/sequences

### Backend services (24)
- [x] setup, activation, users/roles, patients, dentists, visits, chart (FDI), treatments, timeline, referrals
- [x] appointments + queue, prescriptions, invoices/payments, inventory, accounting, staff
- [x] attachments, notifications, search, backup/restore (VACUUM INTO + ZIP + pre-restore), dashboard, audit
- [x] IPC registry (~140 channels) + preload bridge + typed renderer `api.ts`

### Renderer
- [x] Design tokens + components + shell CSS; bundled Inter + Noto Sans Bengali
- [x] Auth frame: Activation, Setup wizard (5 steps), Login, Lock
- [x] AppShell fully routed (no placeholders / ModuleInProgress)
- [x] Pages: Dashboard, Patients + PatientDetail (clinical tabs), Appointments, Queue, Treatments, Prescriptions, Invoices, Payments, Inventory, Accounting, Backup, Users (incl. Staff records), Settings, About
- [x] GlobalSearchPalette (Ctrl+K), NotificationCenter (bell + unread badge)
- [x] Print/PDF buttons on prescriptions, invoices, receipts, accounting reports

### Print / PDF
- [x] HTML templates (prescription, invoice, receipt, accounting report) with paper profiles A4/A5/thermal80/mini
- [x] Hidden BrowserWindow print + printToPDF service
- [x] Fonts as electron-builder `extraResources` (outside asar)
- [x] Permissions: `prescriptions.print`, `invoices.print`, `reports.print`

### Tests
- [x] Unit: money, datetime
- [x] Integration: database, activation, auth, patients, billing, clinical, inventory-accounting, backup-restore, **print-templates**
- [x] **84/84 vitest tests pass** (executed this session)
- [x] `npx tsc --noEmit` EXIT 0
- [x] eslint --max-warnings 0 on changed sources EXIT 0
- [x] Playwright E2E harness + **47 mandatory flows** (6 spec files) — **CI-only** (Electron + better-sqlite3 native binding + `DENTIVA_E2E_ACTIVATION_CODE` secret required)
- [x] GitHub Actions: `ci.yml` (ubuntu quality + windows E2E), `release.yml` (NSIS pack + artifact + GH Release with fallback upload)

## Remaining

1. **Windows CI run** of `ci.yml` / `release.yml` (cannot execute Electron or download GitHub release assets in this sandbox — CDNs blocked).
2. Populate repository secret `DENTIVA_E2E_ACTIVATION_CODE` before first CI E2E run.
3. Final `docs/TEST-REPORT.md` evidence after a green CI run (template present; fill CI URLs/SHAs when available).
4. Optional polish: security/license/UX audit docs expansion; performance notes.

## Known environment limits (this sandbox)

- `npm install` **with** scripts fails (node-gyp headers + Electron binary CDNs blocked). Use `npm install --ignore-scripts`.
- better-sqlite3 native binding and Electron binary **absent** locally → E2E skipped; integration tests use `node:sqlite` DatabaseSync fallback.
- GitHub release asset CDNs unreachable → no local NSIS packaging.

## Test credentials (fixtures only)

- Admin: `admin` / `AdminPass!2026` (`tests/integration/helpers.ts`, E2E helpers)
- Activation: **never in fixtures** — CI injects via `DENTIVA_E2E_ACTIVATION_CODE`

## How to resume

1. Read this file + `git log --oneline | head`.
2. Run `npx vitest run` + `npx tsc --noEmit` as the local gate.
3. E2E only on a machine/CI with Electron + native bindings + the activation secret.
4. Do not re-implement completed services/pages; extend from the Remaining list.
