# Dentiva Pro — Security Audit

Date: 2026-09-27 · Scope: application source as of branch `arena/01a0e35f-dentiva-official-app`.

## 1. Threat model (offline desktop)

| Asset | Threat | Control |
|-------|--------|---------|
| Patient PHI in SQLite | Local disk theft / malware | OS user account isolation; DB lives under Electron `userData`; no cloud sync; soft-delete + audit trail |
| Activation code | Leak via repo / logs / tests | Only scrypt-derived `SHIPPED_VERIFIER` shipped; plaintext never committed; E2E injects via CI secret |
| User passwords | Offline brute force of DB | scrypt N=16384, r=8, p=1, 64-byte output; per-user salt; timingSafeEqual |
| Session | Unattended workstation | Auto-lock timer; lock blocks all IPC except app-state/unlock; Ctrl+L |
| Privilege escalation | UI-only permission hides | Every mutating service calls `sessionManager.ensurePermission(...)` |
| Backup restore wipe | Accidental / malicious restore | `destructive.operations` permission + typed confirmation string + mandatory pre-restore backup |
| IPC attack surface | Renderer compromise | `contextIsolation: true`, `nodeIntegration: false`, preload exposes only typed `invoke`/`on` |
| Path traversal (attachments) | Malicious file names | `sanitizeFileName` strips traversal; extension allowlist in attachments service |
| Print HTML injection | XSS into print window | `escapeHtml` on all dynamic template fields |

## 2. Authentication & activation

- **Activation:** `deriveActivationVerifier(code)` → scrypt(normalized code, pepper `dentiva-pro::v1::activation`, 32 bytes). Compare with `timingSafeEqual` against `SHIPPED_VERIFIER` and any DB-stored verifier. Failed attempts do not reveal which check failed beyond a generic error.
- **Honest limitation (documented in UI copy):** a determined attacker with the binary can extract the verifier and attempt offline guessing of the code space. This is inherent to offline license checks without a phone-home server (explicitly out of scope per product requirements).
- **Passwords:** never logged; login events table records success/failure without password material.
- **Single-session model:** one interactive session at a time per app instance; second-instance focus only.

## 3. Authorization (RBAC)

- Catalog: `src/shared/permissions.ts` (granular strings).
- Built-in roles: Admin (all), Dentist, Receptionist, Accountant with least-privilege defaults.
- Custom roles compose the same permission strings.
- Financial fields (e.g. staff `salary_paisa`, `national_id`) masked unless `staff.manage`.
- UI may hide buttons; **tests and code review confirm service-layer enforcement is the real gate.**

## 4. Data protection

- Money as INTEGER paisa — no float drift / rounding attacks on ledgers.
- SQL via prepared statements only (driver binds parameters).
- Attachments stored outside DB under `data/attachments/` with generated stored names.
- Logs: app/error/security streams under `userData/logs`; no secrets by policy.

## 5. Electron hardening

- `sandbox: false` only because preload needs limited Node for the bridge; renderer has no Node.
- Permission request handler denies all Chromium permission prompts.
- `setWindowOpenHandler` denies; external https/mailto via `shell.openExternal` only.
- `will-navigate` prevented (no drive-by navigation).
- CSP: renderer is `file://` packaged content; no remote script loads.

## 6. Dependency risk

- Production deps: `better-sqlite3`, `yazl`, `yauzl` — mature, narrow purpose.
- Electron version pinned in package.json (^33); CI builds on windows-latest.
- No telemetry SDKs, no analytics, no crash reporters that phone home.
- `npm audit` should be run on CI after full `npm ci` (native install); record findings in release notes.

## 7. Residual risks / accepted

1. Offline activation verifier can be reverse-engineered (accepted product decision).
2. Local admin OS user can read the SQLite file (standard desktop app boundary).
3. Print pipeline writes temp HTML under OS temp — deleted after render; residual race on crash is low impact (contains same data user just printed).

## 8. Findings summary

| Severity | Count | Action |
|----------|-------|--------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 0 open | — |
| Low / informational | Offline verifier limits, local DB readable by OS user | Documented |

**Conclusion:** No critical/high issues identified in source review. Controls match the offline-first desktop threat model.
