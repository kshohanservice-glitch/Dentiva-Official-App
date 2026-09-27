# Dentiva Pro — Test Report

> Evidence log for the final quality gate (master prompt §111 / plan §20).  
> **Honesty rule:** only results that were actually executed are marked PASS. CI-only items stay PENDING until a green run is recorded.

## 1. Local gates (executed in development sandbox)

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| Unit + integration | `npx vitest run` | **PASS — 84/84** (11 files) | Includes money, datetime, database, activation, auth, patients, billing, clinical, inventory-accounting, backup-restore, **print-templates** |
| Typecheck | `npx tsc --noEmit` | **PASS** (EXIT 0) | Strict TS across main/preload/renderer/shared/tests |
| Lint | `npx eslint … --max-warnings 0` | **PASS** on all new/changed sources | Flat config; no `require()` except guarded electron paths |
| Renderer build | (CI) `npm run build:renderer` | PENDING on CI | Vite production build |
| Main/preload build | (CI) `npm run build:main && build:preload` | PENDING on CI | esbuild bundle + schema.sql copy |

### Integration coverage highlights

- **Money:** parseAmountToPaisa, formatBDT, no float drift; invoice grand_total − paid = outstanding.
- **Activation:** wrong code rejected; verifier is scrypt digest (SHIPPED_VERIFIER); plaintext code absent from repo/fixtures.
- **Auth/RBAC:** login lockout path, session lock blocks IPC, permission checks at service layer.
- **Patients:** CRUD, soft-delete, Bengali name round-trip via SQLite.
- **Clinical:** visits, FDI chart (adult 11–48 / primary 51–85), supersede-on-clear, prescriptions multi-item, appointments Friday exclusion + overlap flag, queue sequential numbers.
- **Billing:** integer paisa totals, overpay rejected, void only when paid=0.
- **Inventory:** stock ledger invariant opening+in−out±adj = current_stock; low/expired alerts.
- **Accounting:** income − expenses = net; category rollups.
- **Backup/restore:** ZIP + SHA-256 manifest; mandatory pre-restore backup; rollback on failure path.
- **Print templates:** Bengali conjuncts in Rx HTML (`ডাক্তার`, `দাঁতের ব্যথা`, `অ্যামোক্সিসিলিন`, `ঔষধ`); ৳ formatting; A4/thermal80 page CSS; font files resolvable.

## 2. E2E — 47 mandatory flows (Playwright `_electron`)

**Status: HARNESS READY · EXECUTION CI-ONLY**

Specs live under `tests/e2e/`:

| Spec file | Flows | Domain |
|-----------|-------|--------|
| `01-boot-activation-setup.spec.ts` | 1–8 | Cold boot, activation valid/invalid/empty, setup wizard, bad login, good login, lock/unlock |
| `02-patients-clinical.spec.ts` | 9–18 | Patients CRUD, Bengali name, search, detail tabs, visit, chart finding, treatments, referrals, timeline |
| `03-appointments-queue-rx.spec.ts` | 19–26 | Appointments, queue, prescriptions (multi-med + Bengali advice), treatments catalog |
| `04-billing-payments.spec.ts` | 27–34 | Invoices, payments, BDT symbol, accounting report entry points |
| `05-inventory-accounting-staff.spec.ts` | 35–40 | Inventory item, accounting expense, staff records CRUD |
| `06-backup-search-settings-about.spec.ts` | 41–47 | Backup create, Ctrl+K search, settings, About (Shohan Khan / helloiamshohan@gmail.com), sidebar collapse, notifications |

### Why not executed locally

This sandbox cannot download Electron binaries or better-sqlite3 prebuilds (GitHub release CDN / nodejs.org headers blocked). E2E helpers call `test.skip` unless:

1. `require('electron')` resolves to a real binary path, **and**
2. `better-sqlite3` native binding loads, **and**
3. `process.env.DENTIVA_E2E_ACTIVATION_CODE` is set (repo secret on CI — **never** committed).

Isolation: each launch sets `DENTIVA_USER_DATA` to a temp dir (`src/main/index.ts`).

## 3. CI / Release (workflows present, runs pending)

| Workflow | File | Purpose |
|----------|------|---------|
| CI | `.github/workflows/ci.yml` | Ubuntu: typecheck + lint + vitest + build; Windows: full build + Playwright E2E |
| Release | `.github/workflows/release.yml` | Windows: full gates → electron-builder NSIS → SHA-256 → upload artifact **always** → GitHub Release on tag (fallback = workflow artifact if Release fails) |

### Installer artifact (pending first green release run)

| Check | Expected | Status |
|-------|----------|--------|
| Filename | `Dentiva-Pro-Setup-1.0.0.exe` | PENDING |
| Size | > 1 MB | PENDING |
| SHA-256 sidecar | `*.exe.sha256` | PENDING |
| Published | GitHub Release **or** Actions artifact `Dentiva-Pro-Setup` | PENDING |

## 4. Security / license / UX (summary)

See also `docs/SECURITY-AUDIT.md`, `docs/LICENSE-AUDIT.md`, `docs/UX-AUDIT.md` (created alongside this report).

- **Activation:** local scrypt verifier only; honest about offline verifier limits; code not in source/tests.
- **Passwords:** scrypt N=16384 r=8 p=1 64-byte hash; timingSafeEqual.
- **RBAC:** `sessionManager.ensurePermission` in every mutating service; UI hide is never the only control.
- **IPC:** contextIsolation + no nodeIntegration; structured `{ok,data|error}` envelope.
- **Backups:** pre-restore mandatory; destructive.operations permission for restore.
- **Dependencies:** Electron, React, better-sqlite3, yazl/yauzl, Vite, Playwright — all conventional open-source licenses (MIT/Apache/BSD); app itself UNLICENSED proprietary.

## 5. Reconciliation invariants (under automated test)

- `grand_total_paisa - paid_paisa = outstanding`
- payments ledger Σ = invoice paid
- accounting `totalIncome - totalExpense = netIncome`
- inventory `opening + in - out ± adjust = current_stock`

## 6. Sign-off checklist (fill after CI)

- [ ] CI `quality` job green (SHA: ______)
- [ ] CI `e2e-windows` 47/47 green (SHA: ______)
- [ ] Release workflow produced `.exe` (URL or artifact id: ______)
- [ ] Clean Windows runner install smoke (manual or scripted): ______
- [ ] Bengali glyphs visible in a printed/PDF sample from CI artifact: ______

**Current honest status:** local automated suite green (84 tests); E2E + installer packaging implemented and wired for CI but **not yet executed** in this environment.
