# Dentiva Pro — UI/UX Audit

Date: 2026-09-27 · Product: offline dental PMS for Bangladesh clinics.

## 1. Design system

- **Tokens:** primary cyan clinical palette, density modes, reduced-motion respect (`prefers-reduced-motion` + `data-animations=off`).
- **Typography:** Inter (UI Latin) + **Noto Sans Bengali** (conjuncts/ligatures) bundled offline — no CDN font fetch.
- **Components:** Button (primary/secondary/ghost/danger), Field, Input, Select, Textarea, Modal, ConfirmDialog (optional `requireText`), Badge, EmptyState, ErrorState, LoadingRows, Toast, Pagination, SearchInput, segmented tabs.
- **Shell:** collapsible sidebar (persisted), topbar with global search (Ctrl+K), notifications bell + unread badge, lock (Ctrl+L), user menu.

## 2. Information architecture

| Area | Routes | Notes |
|------|--------|-------|
| Practice | Dashboard, Patients, Appointments, Queue | Day-forward clinical ops |
| Clinical | Treatments catalog, Prescriptions | Patient-level clinical lives on Patient Detail tabs |
| Billing | Invoice, Payments, Inventory, Accounting | BDT ৳ everywhere; paisa integer under the hood |
| Admin | Staff & Users, Backup & Restore, Settings, About | RBAC-aware |

Patient Detail tabs: Overview (incl. attachments), Visits, Dental chart (FDI), Treatments, Prescriptions, Referrals, Timeline, Financial — **no placeholder cards**.

## 3. Interaction patterns (consistency check)

- Page chrome: `.page` → `.page-header` (crumb + h1 + actions) → `.toolbar` → content.
- Destructive actions: `ConfirmDialog`; restore/delete staff may require typing the name.
- Cross-page navigation: `dp:navigate` CustomEvent (search hits, notification links).
- Empty/error/loading states on every list page — no blank white panels.
- Money entry: decimal strings → `parseAmountToPaisa`; display via `formatBDT`.

## 4. Accessibility

- Icon-only buttons carry `aria-label`.
- Main nav: `aria-label="Main navigation"` + `aria-current="page"`.
- Tabs use `role="tablist"` / `role="tab"`.
- **Field** uses a real `<label>` wrapping the control (screen reader + Playwright `getByLabel`).
- Focus: modal focus trap via standard dialog pattern; lock screen password field autofocus.
- Color: status badges use tone + text, not color alone.

## 5. Localization / Bengali

- Free-text fields accept Unicode; SQLite stores UTF-8.
- Print templates include Bengali labels (রোগী, উপদেশ, সকাল/দুপুর/রাত, ধন্যবাদ) and clinical free text.
- Sample conjuncts verified in print-template tests: ডাক্তার, দাঁতের ব্যথা, অ্যামোক্সিসিলিন, ঔষধ, ব্যবস্থা.

## 6. Density & DPI

- CSS tokens scale spacing; compact density via `data-density='compact'`.
- Shell min window 1180×700; target widths 1280–1920 documented in plan.
- 125–200% OS scaling: Chromium handles layout; no absolute px fonts for body text outside tokens.

## 7. Error & empty copy

- Errors surface the service message (permission denied, overpayment, validation) via toast or inline `field-error` / `ErrorState` with Retry.
- Empty states explain the next action (“Record the first consultation…”), never “Coming Soon”.

## 8. Findings

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| UX-1 | Low | Some complex multi-column forms could use sticky footers on short laptops | Accepted / monitor |
| UX-2 | Info | Invoice nav label is singular “Invoice” (consistent with code; E2E matches) | OK |
| UX-3 | Fixed | Field labels were `<span>` — switched to `<label>` for a11y + E2E | Done |

## 9. Conclusion

UI matches the premium clinical brief: calm density, real controls only, Bengali-capable, keyboard shortcuts for search/lock, and consistent patterns across all modules. No fake stats/charts/buttons remain in the shell.
