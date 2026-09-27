# Dentiva Pro — Master Implementation Plan

**Version:** 1.0.0 · **Status:** Approved baseline · **Owner:** Lead Engineering Agent
**Target:** Production-ready, offline-first Windows desktop Dental Practice Management System for clinics in Bangladesh.

---

## 1. Product Architecture

Dentiva Pro is a **single-machine, multi-user, offline-first desktop application**. There is no server tier, no cloud dependency, and no runtime network requirement. All data lives on the local machine in an embedded SQLite database plus an application-managed file store (attachments, branding assets, backups).

Logical layers (all in-process):

```
┌────────────────────────────────────────────────────────────┐
│ Renderer (React UI) — views, forms, tables, print previews │
│   talks only through the typed, promise-based Bridge API   │
├────────────────────────────────────────────────────────────┤
│ Preload (contextBridge) — thin, typed IPC surface          │
├────────────────────────────────────────────────────────────┤
│ Main process (Node)                                        │
│   IPC Router → Permission Gate → Service Layer → Repos     │
│   Auth / Sessions / RBAC / Audit / Backup / Print service  │
├────────────────────────────────────────────────────────────┤
│ SQLite (better-sqlite3, WAL, FK-enforced) + File Store     │
└────────────────────────────────────────────────────────────┘
```

Key product properties:
- **Offline-first:** every feature works with the network cable unplugged.
- **Multi-user, single workstation model:** one active session at a time, lock/unlock supported, per-user RBAC enforced in the service layer (never only in UI).
- **Money-safe:** all monetary values stored/processed as integer paisa (1 BDT = 100 paisa). Floating point is never used for money.
- **Historically faithful:** clinical and financial records are append-mostly with soft deletion; destructive operations require permission + explicit confirmation.

## 2. Technology Selection & Justification

| Concern | Decision | Why |
|---|---|---|
| Language | **TypeScript (strict)** end-to-end | One language across UI/main/tests; static typing catches large classes of defects; mature tooling. |
| Desktop runtime | **Electron (LTS)** | The most mature, actively maintained cross-desktop shell; first-class Windows support; bundles its own Chromium + Node so clean machines need no extra runtime; gives us real print APIs. MIT-2 licensed. |
| UI framework | **React 18** + hand-rolled design system on CSS custom properties | Largest mature ecosystem; component model fits dense clinical screens; a custom token-based CSS system avoids heavy UI-lib styling lock-in and keeps the bundle small. |
| Build tooling | **Vite** (renderer) + **esbuild** (main/preload bundles) | Fast, deterministic, widely maintained. Release builds are separate production bundles. |
| Database | **SQLite via better-sqlite3** | Embedded, zero-config, battle-tested relational engine; synchronous API simplifies transactional service code; WAL mode gives good concurrency + crash safety; single-file backup story. Prebuilt native binaries for Windows x64. Public domain (SQLite core) / MIT (driver). |
| Money | **Integer paisa (fixed-point)** | Exact arithmetic; rounding rules centralized; BDT display `৳ 12,345.00`. |
| Password hashing | **Node `crypto.scrypt`** (built-in) with per-user 16-byte salt, N=16384, r=8, p=1, timing-safe compare | Established memory-hard KDF; zero added native dependencies; no reversible storage. |
| Activation verifier | **SHA-256-derived digest comparison** (`scrypt(code, app-pepper)` digest, timing-safe) | No plaintext code anywhere in source/resources/tests; only the derived verifier ships. Honest limitation documented: a local-only verifier can be reverse-engineered by a determined attacker with binary access. |
| PDF + Printing | **Chromium print pipeline inside Electron**: documents rendered as semantic HTML/CSS in a hidden render window → `webContents.printToPDF()` (PDF) and `webContents.print()` (any Windows printer: wired, wireless, Bluetooth) | Real text (searchable, font-embedded), correct complex-script shaping for Bengali, identical output for PDF and print, adaptive multi-paper layout from one renderer, true print preview. No paid API. |
| Bengali rendering | **Noto Sans Bengali** (+ Noto Sans / Inter for Latin) bundled with the app, referenced via local `@font-face` | OFL-licensed, complete Bengali coverage, correct conjunct/ligature shaping in Chromium; works in UI, PDF and print; no runtime font download. |
| Backup | SQLite **VACUUM INTO** (consistent snapshot) + attachments/branding files → timestamped **ZIP** (yazl) with SHA-256 manifest; restore via yauzl with validation + mandatory pre-restore backup | Atomic, portable, verifiable backups that survive partial disk issues. |
| Installer | **electron-builder → NSIS** per-user+all-users capable installer, LZMA, custom icon, uninstaller, upgrades | Industry-standard for Electron on Windows; runs on GitHub-hosted Windows runners. |
| Unit/integration tests | **Vitest** | Same TS toolchain, fast, native ESM; DB tests run against temp-file SQLite. |
| UI/E2E tests | **Playwright `_electron`** driver | Officially supports launching the real Electron app cross-platform (runs on Linux CI + Windows CI); exercises real IPC + DB. |
| CI/CD | **GitHub Actions** (`ci.yml`, `release.yml`) | Mandatory per spec; Windows packaging must run on `windows-latest`. |
| Logging | Structured JSON-lines logger, rotating files in `%APPDATA%/Dentiva Pro/logs` | Separate app/error/security streams; secrets never logged. |
| State management (UI) | Local component state + small typed data hooks over the bridge; server-style cache invalidation per mutation | Avoids heavy global stores; keeps data flow auditable. |

Rejected alternatives (recorded for traceability): .NET/WPF (Windows-only toolchain, poor fit for this repo's CI and single-language policy), Tauri (Rust toolchain adds build complexity; printing/multi-window story weaker at present), Python/Qt (weaker premium-UI ergonomics, large packaging), Firebase/Atlas/cloud (violates offline rule), paid PDF APIs (violates offline + cost rules).

## 3. Application Architecture

- **Process model:** Electron main (Node) owns all privileged operations: DB access, filesystem, printing, backup, auth. The renderer is sandboxed (`contextIsolation: true`, `nodeIntegration: false`, strict CSP) and can only call the typed bridge API exposed by the preload script.
- **Service layer (main):** every domain operation is a service method: `requirePermission(perm)` → validate input → transaction → mutate → audit → return DTO. Financial permissions are enforced here, not in the UI.
- **IPC:** namespaced channels (`patients:list`, `invoices:create`, …). All handlers validate arguments (zod-style runtime schemas) and return typed results or structured errors. Renderer never touches SQLite or the filesystem directly.
- **Sessions:** login creates a session row; auto-lock suspends the session (UI covered by lock screen), unlock re-verifies password; logout terminates it. Login history + failed-attempt monitoring included.
- **Audit:** append-only `audit_logs` written in the same transaction as the audited change (or immediately after for auth events).
- **Error handling:** services throw typed `AppError`s with user-safe messages; IPC layer maps them; renderer shows actionable messages; main-process crash handler logs + recovers; raw stack traces are never shown to non-admin users.

## 4. Folder / Module Architecture

```
Dentiva-Official-App/
├── docs/                    # all engineering + user documentation
├── build/                   # installer resources (icon.ico, license)
├── resources/fonts/         # Noto Sans, Noto Sans Bengali (bundled, OFL)
├── scripts/                 # icon build, seed utilities, maintenance
├── src/
│   ├── shared/              # types, DTOs, permission list, money/date utils
│   ├── main/
│   │   ├── index.ts         # app lifecycle, window management, crash recovery
│   │   ├── db/              # connection, schema.sql, migrations, seed
│   │   ├── services/        # auth, activation, setup, patients, visits, chart,
│   │   │                    # appointments, queue, prescriptions, invoices,
│   │   │                    # payments, inventory, accounting, staff, users,
│   │   │                    # referrals, attachments, notifications, search,
│   │   │                    # reports, backup, settings, audit
│   │   ├── ipc/             # channel registry + validation
│   │   ├── print/           # document HTML builders + printer/PDF pipeline
│   │   └── util/            # logger, paths, filesafe, errors
│   ├── preload/index.ts     # contextBridge surface
│   └── renderer/
│       ├── index.html / main.tsx / App.tsx
│       ├── design/          # tokens.css, base.css, components.css
│       ├── components/      # design-system primitives (Button, Table, Modal,…)
│       ├── pages/           # Login, Activation, SetupWizard, Lock, shell pages
│       ├── shell/           # TopBar, Sidebar, NotificationCenter, SearchPalette
│       └── hooks/, lib/
├── tests/
│   ├── unit/                # vitest: money, validation, permissions logic
│   ├── integration/         # services vs real temp SQLite DB
│   └── e2e/                 # Playwright Electron: critical flows
├── .github/workflows/       # ci.yml, release.yml
└── electron-builder.yml
```

## 5. Database Architecture

SQLite, WAL journal mode, `foreign_keys=ON`, `synchronous=NORMAL`, busy timeout. One DB file (`dentiva.db`) in `%APPDATA%/Dentiva Pro/data`, plus `attachments/` and `branding/` folders next to it.

Conventions: snake_case tables; `id` INTEGER PK; ISO-8601 UTC timestamps (`created_at`, `updated_at`); soft delete via `deleted_at` + `status` where history matters; money as INTEGER paisa; ON DELETE rules chosen to prevent orphans; indexes on every FK and on hot search columns. Schema versioning via `schema_migrations` with forward-only numbered migrations applied inside a transaction. Full ER narrative in `docs/DATABASE.md`.

Core entities (≈40 tables): clinic, activation_state, dentists, users, roles, permissions, role_permissions, user_roles, sessions, login_events, patients, visits, clinical_notes, chart_entries (tooth conditions, FDI adult 11–48 / pediatric 51–85), treatments, treatment_records, appointments, queue_entries, prescriptions, prescription_items, medicines (catalog), invoices, invoice_items, payments, payment_methods, refunds, suppliers, inventory_items, inventory_batches, inventory_transactions, income_categories, income_entries, expense_categories, expense_entries, staff, referrals, attachments, notifications, audit_logs, backups, settings, printer_profiles, holidays.

## 6. UI/UX Architecture

Premium clinical design language documented in `docs/DESIGN-SYSTEM.md`:

- **Colors:** primary teal `#0E7490` family (calm, clinical, tech), neutral slate surfaces, semantic success/warn/error/info. Contrast ≥ WCAG AA on all text.
- **Typography:** Inter / system fallback for UI; 12–14px base; 6 weights; strict scale (11/12/14/16/20/24/30).
- **Spacing:** 4px base scale (4/8/12/16/24/32/48); radius 6/10/14; elevation via subtle borders + minimal shadows.
- **Layout:** fixed top bar (56px), collapsible sidebar (240px ↔ 64px, state persisted), content area with consistent page headers, 12-col grids that reflow at 1280/1366/1600/1920 and 125–200% DPI (CSS handles scaling; tested).
- **States everywhere:** every screen has loading (skeleton), empty (message + primary action), error (retry), success (toast). Every control defines default/hover/focus-visible/pressed/disabled/loading.
- **Motion:** ≤180ms ease-out transitions; respects reduced-motion setting.
- **Accessibility:** full keyboard operation, visible focus rings, logical tab order, accessible names on all controls, contrast-checked palette.

Navigation model: authenticated shell with grouped sidebar (Practice / Clinical / Billing / Administration), top-bar with clinic name, date, user, notifications, search, lock/menu. Global search palette on `Ctrl+K`. Shortcuts documented in the User Guide.

## 7. Security Architecture

- Renderer sandboxed; IPC is the only door; every channel validates input and enforces RBAC in the service layer (requirement 40).
- SQL is always parameterized (better-sqlite3 prepared statements) — no string-built queries with user input.
- Filesystem: all attachment paths stored as opaque IDs under the app-managed store; original filenames sanitized; path traversal impossible by construction (no user-controlled absolute paths); executable extensions rejected; size caps enforced.
- Backups are plain ZIPs with a manifest; restore validates manifest hashes + schema version before touching live data and always takes a pre-restore backup first.
- No secrets in logs/audit/errors. Passwords scrypt-hashed. Lock screen enforced by the main process (renderer cannot bypass: IPC refuses non-unlock calls while locked).
- Honest statement: activation is a local verifier — obfuscated against casual extraction, not cryptographically tamper-proof. Documented in `docs/SECURITY.md`.

## 8. Authentication Architecture

First-run setup wizard creates the first admin (username, scrypt-hashed password, policy-validated). Login screen thereafter. Sessions tracked in DB (device-local): created on login, ended on logout/shutdown, suspended on auto-lock (configurable 5/10/15/30 min inactivity; timer resets on UI activity; main process owns the truth). Failed logins logged + throttled (progressive delay after repeated failures). Generic error copy ("Invalid username or password") to avoid account enumeration. Auto-lock never loses unsaved form work — the lock screen overlays the shell.

## 9. RBAC Architecture

Built-in roles: **Admin, Dentist, Receptionist, Accountant**, plus **Custom** roles composed of granular permissions. ≈60 granular permissions covering view/create/edit/delete per domain, print, financial view, backup/restore, settings, destructive ops, audit viewing. Enforced exclusively in services (`ensure(perm)`); UI hides/ disables what is not permitted but never relies on that. Test matrix per requirement 105 lives in integration tests.

## 10. Backup / Restore Architecture

- **Manual backup:** `VACUUM INTO` snapshot of the DB + copy of attachments/branding + `manifest.json` (versions, counts, SHA-256 per file) → ZIP named `DentivaPro_Backup_YYYY-MM-DD_HH-mm-ss.zip` in the configured folder; never overwrites (timestamp collision → suffix).
- **Automatic:** every 7/15/30 days or disabled; due-check at startup; results written to `backups` table + notification center; missing/unwritable folder → loud warning, never silent.
- **Restore:** validate ZIP + manifest + schema compatibility → mandatory pre-restore backup → explicit typed confirmation for full restore → swap DB file + files inside a guarded sequence → integrity check (`PRAGMA integrity_check`) → success/failure report; on failure the pre-restore state is reinstated. Retention policy (keep last N) configurable.

## 11. Printing Architecture

A single **document renderer**: each document type (prescription, invoice, receipt, report) has an HTML/CSS template function producing semantic markup against the design tokens + paper profile. Printing flow: hidden `BrowserWindow` (offscreen render window) loads the document → measured → user picks printer/paper/copies in Print Preview (real rendered document) → `webContents.print()` with the selected printer and page size, or `printToPDF()` for Save-as-PDF. Paper profiles: A4, A5, Mini (4×6"), thermal 80mm, custom WxH — the CSS adapts via CSS custom properties for dimensions/margins/font scale, so one template serves all papers without clipping or overlap. Printer discovery uses `webContents.getPrintersAsync()` (covers wired, network/wireless, Bluetooth printers exposed through Windows). Bengali verified via bundled Noto Sans Bengali (font embedding in PDF is automatic).

## 12. PDF Architecture

`printToPDF` from Chromium: real vector text, embedded fonts (incl. Bengali), correct page sizes/margins, selectable text. Same render window as printing → pixel-consistent PDF vs print (requirement 27). PDFs for prescriptions, invoices, receipts, and every report. No external PDF service.

## 13. Bengali Unicode Strategy

- Database: SQLite stores UTF-8 natively; all IPC is UTF-8/JSON — no codepage conversion anywhere.
- UI: React/Chromium render Bengali natively; inputs accept Bengali freely (names, addresses, notes, C/C, O/E, advice, invoice text, clinic footer/tagline).
- Fonts: Noto Sans Bengali bundled; used in UI, print CSS and PDF (embedded subset).
- Search: `LIKE`/instr over UTF-8 works for Bengali substring search; indexes support it.
- Verification: integration + E2E tests assert Bengali round-trips through DB, search, and PDF byte output (font-embedding check); sample strings include conjuncts (e.g. "ডাক্তার", "ব্যবস্থা", "ঔষধ").

## 14–20. Data Models

Detailed per-entity schemas in `docs/DATABASE.md`. Highlights:

- **Patient:** unique `patient_code` (auto-suggested `P-000001`, editable, uniqueness enforced), demographics, contacts, complaints/history/notes, photo path, status, soft delete, created_by; unlimited records; paginated access only.
- **Clinical:** visits (complaint→examination→diagnosis→treatment→advice→follow-up), clinical_notes, chart_entries keyed by FDI tooth + condition taxonomy (caries/restoration/missing/extraction/RCT/crown/fracture/mobility/impacted/infection/other), treatment_records linked to visits & invoice lines. Chronological timeline assembled from a union query over typed events.
- **Billing:** invoices (numbered `INV-####` sequence from settings, items snapshot price at billing time, discount, optional tax, computed totals in paisa), payments (8 methods incl. bKash/Nagad/Rocket/Upay, no overpayment beyond balance unless explicit credit), refunds, status derived (Paid/Partially Paid/Unpaid). Invariants tested: grand_total − paid = outstanding, per patient and globally.
- **Inventory:** items + batches (expiry, batch no) + transaction ledger (IN/OUT/ADJUST with reason; ledger never deleted), low-stock & expiry alert generation.
- **Accounting:** income/expense entries against configurable categories; reports aggregate real rows.
- **Staff/Users:** staff profiles (salary etc. gated by permission) optionally linked to user accounts; users with roles, lock/disabled states, password reset.
- **Audit:** timestamp, user, action, entity, entity_id, result, safe metadata JSON; immutable.
- **Notifications:** generated by alert rules (appointments, queue, overdue balances, stock, expiry, backup results); read/unread; actionable links.

## 21. Search Architecture

Global search palette (`Ctrl+K`) fans out to per-entity prepared queries (patients by code/name/phone/address; appointments; invoices by number; payments; prescriptions; inventory by name/SKU; staff; treatments), each capped (top N per entity), paginated, and permission-filtered (financial entities only for permitted users). Indexed columns; LIMIT everywhere; never loads full tables.

## 22. Queue Architecture

Queue entries created from walk-in check-in or appointment arrival; queue number per day per dentist; statuses waiting/in-treatment/completed/skipped; priority flag; UI updates via targeted refresh after mutations (no polling loops); dashboard reflects live DB aggregates.

## 23. Testing Architecture

- **Unit (Vitest):** money math, validators, date ranges, invoice/payment/inventory/ledger computations, permission sets.
- **Integration (Vitest + real temp SQLite):** every service incl. auth, RBAC matrix, reconciliation invariants, backup→modify→restore round-trips, audit writing, search, alerts.
- **E2E (Playwright Electron):** the 47 mandatory flows (grouped into scenario suites) + negative cases (bad login, overpayment, unauthorized access, invalid backup…) + smoke screenshot assertions for major screens.
- Gates: `npm run test` runs unit+integration; `npm run test:e2e` runs app flows; CI runs both; release blocked on failure.

## 24. CI/CD Architecture

GitHub Actions:
- `ci.yml` (push/PR): setup-node 20, npm ci, typecheck, lint, unit+integration tests, renderer build (ubuntu for speed) plus a Windows matrix job that builds the app and runs E2E smoke.
- `release.yml` (tag `v*` or manual dispatch): windows-latest, full test suite, electron-builder NSIS package, artifact validation (size>0, filename check), upload `Dentiva-Pro-Setup-x.y.z.exe` to GitHub Release; **fallback:** artifact also committed to the job's `dist/` and uploaded as workflow artifact even if Release creation fails (requirement 93/94).

## 25. Installer Architecture

electron-builder + NSIS: per-machine install with elevation prompt, desktop + Start Menu shortcuts, `build/icon.ico` (256px multi-size), uninstaller that removes program files but **never touches** `%APPDATA%/Dentiva Pro` (user data survives uninstall; optional checkbox to purge data), upgrade-over-install supported via NSIS one-click+assisted hybrid (`allowToChangeInstallationDirectory`), app metadata (name, version, publisher "Shohan Khan", description).

## 26. Release Architecture

SemVer version in `package.json` + build metadata injected at build time (commit SHA into About). Release = GitHub Release with setup exe + SHA-256 checksum file + release notes. `docs/RELEASE-CHECKLIST.md` gates every release.

## 27. Dependency / License Strategy

Only permissive licenses (MIT/Apache-2.0/BSD/ISC/Public-Domain/BSL-free runtime). Full audit table in `docs/DEPENDENCY-LICENSE-AUDIT.md`; OFL font notices bundled in About → Third-party notices. No GPL runtime dependencies. No telemetry/analytics dependencies at all.

## 28. Performance Strategy

- Paginated/virtualized lists (patients, audit, invoices) — 50–100 rows per page with indexed queries.
- Prepared statements cached; read-only dashboard aggregates computed in SQL, not JS loops.
- Renderer never receives more rows than displayed; attachments streamed/copied with size guards.
- Benchmarks (stress harness): 10k patients / 50k visits / 50k appointments / 50k invoices / 100k audit rows — search < 200ms, list pages < 150ms targets, recorded in `docs/TEST-REPORT.md`.

## 29. Failure / Recovery Strategy

WAL + transactions give crash-safe DB; startup runs `PRAGMA integrity_check` and offers restore-from-last-backup on corruption; missing attachments degrade gracefully (placeholder + warning); printer absence → clear message, PDF path always available; failed backups → notification + log; settings validated with fallback defaults; global error boundary in renderer; main-process unhandled exceptions logged and surfaced as user-safe dialogs; auto-saved form drafts where cheap to do safely.

## 30. Acceptance Criteria

The master prompt sections 1–120 are the acceptance criteria, verbatim. In particular: all 111 final-quality-gate questions answered YES with evidence in `docs/TEST-REPORT.md`; no fake functionality; no mandatory TODOs; installer tested on a clean Windows runner; Bengali verified in PDF output; reconciliation invariants green.

## 31. Definition of Done

Per master prompt §113: implementation complete, all mandatory tests pass, security + license + UX audits done and documented, performance/stress recorded, clean-machine install validated, release workflow green, artifact published (GitHub Release or `dist/`), documentation matches reality, zero known critical/high issues, zero fake UI, tested `.exe` exists.

---

## Significant Engineering Decisions Log

| # | Decision | Rationale |
|---|---|---|
| D1 | Electron + React + TS over .NET/Tauri/Qt | Single-language stack, mature Windows packaging via electron-builder on CI, superior print/PDF APIs, offline by construction. |
| D2 | better-sqlite3 over async drivers/electron-store | Relational integrity + transactions are mandatory (invoices, ledger); synchronous API keeps service code transactional and simple. |
| D3 | Chromium-based document rendering for PDF/print | One layout engine for screen-preview, PDF and all printers; free, correct Bengali shaping; no paid services. |
| D4 | scrypt from Node core for password hashing | Memory-hard standard KDF without adding native modules to the installer surface. |
| D5 | Integer paisa money model | Exact BDT arithmetic; centralized rounding. |
| D6 | Activation as derived digest verifier, honestly documented | Meets "no plaintext code" requirement while acknowledging local-verifier limits. |
| D7 | Service-layer RBAC as the single enforcement point | Requirement 40 (financial security) cannot be met by UI hiding. |
| D8 | Timestamped ZIP backups with manifest + pre-restore backup | Verifiable, non-destructive restore path (requirements 44–46, 90). |
