# Dentiva Pro — Dependency & License Audit

Date: 2026-09-27

## Application license

- Package `license` field: **UNLICENSED** (proprietary).
- Copyright: © 2026 Shohan Khan. All rights reserved.
- Contact: helloiamshohan@gmail.com
- The application source is **not** open source; third-party packages below retain their own licenses.

## Production runtime dependencies

| Package | Role | License (typical / declared) | Notes |
|---------|------|------------------------------|-------|
| `better-sqlite3` | SQLite native binding | MIT | Optional at runtime when Electron ships; tests fall back to Node `node:sqlite` |
| `yazl` | ZIP writer (backups) | MIT | |
| `yauzl` | ZIP reader (restore) | MIT | |

## Bundled fonts (resources/fonts + renderer assets)

| Font | Files | License |
|------|-------|---------|
| Inter (latin 400–700) | `Inter-*.woff2` | SIL OFL 1.1 |
| Noto Sans Bengali (400–700) | `NotoSansBengali-*.woff2` | SIL OFL 1.1 |

OFL allows bundling and embedding in PDF/print output. Fonts were vendored from `@fontsource/*` packages and the npm packages were **not** left as runtime dependencies (binary assets only).

## Key development / build dependencies

| Package | License | Use |
|---------|---------|-----|
| `electron` | MIT | Desktop shell |
| `electron-builder` | MIT | NSIS packaging |
| `react` / `react-dom` | MIT | UI |
| `vite` / `@vitejs/plugin-react` | MIT | Renderer build |
| `esbuild` | MIT | Main/preload bundle |
| `typescript` | Apache-2.0 | Types |
| `vitest` | MIT | Unit/integration |
| `@playwright/test` | Apache-2.0 | E2E |
| `eslint` / `typescript-eslint` | MIT | Lint |
| `zod` | MIT | (available for validation helpers) |
| `sharp` / `png-to-ico` | Apache-2.0 / MIT | Icon generation script only |

## License compatibility conclusion

- All third-party packages used are **permissive** (MIT / Apache-2.0 / OFL).
- No GPL/AGPL dependencies that would force source disclosure of Dentiva Pro.
- No known paid/proprietary SDKs.
- Attribution for OFL fonts is satisfied by retaining font files and this audit note; UI About page credits the product developer (Shohan Khan) separately.

## Action items

1. On first full `npm ci` CI run, archive `npm ls --all` and `license-checker` (or equivalent) output next to the release.
2. If Electron or Chromium license notices are required in the installer, electron-builder’s default license page can list them — confirm before public distribution.
