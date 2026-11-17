# Rudra Health OS — Acceptance Batch 1

Date: 17 November 2026  
Scope: W007, W008, W010, S001, R015, R014, R007 and R010  
Environment: isolated local Next.js runtime, disposable PostgreSQL schema, synthetic records, test-only credentials and encryption material, Playwright Test with Chromium. No external providers were configured.

## Result

The eight screens received real Chromium interaction checks, but none is finally accepted. Two Playwright journeys passed after fixing a browser-discovered appointment-calendar defect. Repository tests passed. The production build compiled and generated its routes, but the build command exited with code 1 at Next.js's security advisory gate; this is a release blocker and needs a separately reviewed dependency upgrade.

| Screen | Browser evidence | Verified behavior | Remaining acceptance work |
| --- | --- | --- | --- |
| W007 — Public booking stepper | Chromium; desktop/tablet/mobile | Centre and synthetic catalogue selection, validation, review handoff, no personal contact in browser storage, home-collection preference and customer-reported fee retained | Full error/retry variants, manual design comparison and human accessibility review |
| W008 — Booking review & confirmation | Chromium; desktop/tablet/mobile | Review displays selected service, requested collection details, customer-reported fee, unavailable online payment, and that this is not a confirmed booking | Full accessibility and approved reference comparison |
| W010 — Booking acknowledgement | Chromium; desktop/tablet/mobile | Accepted enquiry returns HTTP 202 and acknowledgement says no appointment confirmation, slot reservation or payment | Remaining variants and manual Owner/QA acceptance |
| S001 — Staff login, MFA & sessions | Chromium; desktop/tablet/mobile | Synthetic Better Auth sign-in, TOTP enrollment and verification, protected navigation, keyboard Tab focus-visible, sign-out; post-sign-out protected API returned 401 | Expiry, recovery, trusted-device policy, screen-reader and broader auth/security review |
| R015 — Calls / enquiries / callbacks | Chromium; desktop/tablet/mobile | Protected queue displayed the submitted synthetic enquiry; CRM conversion action completed; wrong-centre request returned 403 and branch API returned 403 for this role | Full queue states, additional roles/centres, retry/error and accessibility review |
| R014 — Lead detail | Chromium; desktop/tablet/mobile | Lead opened from conversion, missing stage reason blocked submit, valid synthetic reason saved; permitted patient conversion completed | Full assignment/follow-up/conflict states, identity policy and manual review |
| R007 — Appointment calendar | Chromium; desktop/tablet/mobile | Appointment request was created through the UI (HTTP 201, `REQUESTED`) and appeared in a subsequent authorized read. The calendar rendered without browser exceptions after the formatter fix | Reschedule/assign/filter/error states, broader accessibility and scheduling policy review |
| R010 — Diagnostic order detail | Chromium; desktop/tablet/mobile | A synthetic draft order was created through the API (HTTP 201, `DRAFT`) and rendered on the detail screen | Create/edit interactions in the UI, pricing/approval rules, conflicts and full order workflow |

The initial browser run exposed an R007 runtime exception: `Intl.DateTimeFormat` rejected a combination of `weekday` with `dateStyle` and `timeStyle`. The calendar now formats explicit weekday/year/month/day/hour/minute fields. The final browser suite passed **2/2 journeys** after this change. A direct `node --test` invocation was incompatible with the Vitest test file; the correct focused Vitest invocation passed 23/23.

## Workflow and security evidence

The public request journey submitted the same idempotency key on retry after a simulated first-request 503; the retry received HTTP 202. The receipt was then visible in the protected reception enquiry queue and converted to a linked lead. The lead stage PATCH returned 200 only after a reason was supplied. Patient conversion returned 200. The appointment request returned 201 with `REQUESTED`, and an authorized read returned the same appointment. A synthetic draft order linked to that patient and appointment returned 201 and remained `DRAFT`.

The synthetic staff session was created by the existing Better Auth/TOTP setup flow; the test did not bypass MFA. Wrong-centre enquiry access and an ungranted branch workflow both returned 403. After sign-out, a protected lead API returned 401. The disposable test role was verified as least-privileged and unable to access the persistent development database. One disposable schema replayed 100 source migrations; the schema, temporary credentials, keys and test staff were dropped/cleared after the final run. The app process was stopped and localhost port 3100 was no longer listening.

No identity verification, clinical procedure, confirmed appointment, payment, legal invoice, Metropolis receipt or report release was represented as complete. The order POST was invoked by the browser test via the API, not through an order-creation UI form.

## Responsive, accessibility and visual evidence

For all eight screens, Chromium checked document/body width at 1440×960, 768×1024 and 390×844; no horizontal overflow was observed. Desktop and 390px screenshots were captured in the restricted external evidence folder. Keyboard Tab focus and visible focus were directly checked on S001 only; forms on other screens were operated with accessible Playwright labels. This was not a screen-reader, contrast, full keyboard, or assistive-technology audit. The approved canonical images were not available as local comparison files, so pixel/design parity is unverified.

## Reproducing the isolated browser run

The reusable harness is outside the repository at `F:\Rudra Health Care Centre\Rudra Health OS Audit\Wave12_Browser_Tooling`; it uses Playwright Test 1.65.1 and Chromium 159.0.8154.6, with an isolated application copy at `Wave12_Isolated_Runtime_R2\app`. The test command was:

```powershell
node 'F:\Rudra Health Care Centre\Rudra Health OS Audit\Wave11_Browser_Tooling\node_modules\@playwright\test\cli.js' test --config='F:\Rudra Health Care Centre\Rudra Health OS Audit\Wave12_Browser_Tooling\batch1-tests\playwright.config.cjs'
```

The harness requires the dedicated test database and least-privilege test role. For each run it creates a uniquely named disposable schema, replays source migrations, creates synthetic fixtures and test-only keys, starts the application with an explicit environment allowlist, then removes the schema and temporary authentication/configuration files. Never point it at the persistent development database or reuse its temporary `.env.local` and synthetic login files.

## Verification

| Check | Result |
| --- | --- |
| Acceptance Batch 1 Playwright/Chromium | 2/2 journeys passed after the R007 fix |
| Full Vitest | 981/981 passed across 249 files (10 minutes) |
| Inventory generator regression | 23/23 passed |
| ESLint | Exit 0 |
| TypeScript | `tsc --noEmit` passed |
| Inventory reconciliation | Wrote 178 canonical rows and preserved manual acceptance values |
| Production build | Compiled; generated 406 routes; two attempts exited 1 at Next.js security advisory gate |
| Git whitespace check | `git diff --check` reported no whitespace errors; Git emitted normal Windows LF/CRLF warnings |

The build output states that the installed Next.js version is affected by a known security vulnerability, strongly recommends upgrading, and stopped to display its upgrade recommendation. Retrying `npm.cmd run build` produced the same security gate after compilation and route generation. No dependency upgrade was run in this batch.

## Screen dispositions

All eight remain `Partially implemented`; Owner/QA acceptance remains pending. Browser evidence is recorded separately from implementation and manual approval in `SCREEN_IMPLEMENTATION_MATRIX.csv`. The generator preserved existing manual acceptance columns; no screen was promoted to completed or accepted by this report.

## Remaining-work register

| Priority | Owner | Item | Dependency / next action |
| --- | --- | --- | --- |
| P0 | Engineering / Security | Resolve Next.js security advisory and rerun production build | Review upgrade diff in an isolated Git worktree, then regression-test; no upgrade executed |
| P1 | QA / Product | Complete screen-specific desktop/mobile, error, retry, permission and keyboard checks for all eight screens | Use isolated browser harness; capture additional states |
| P1 | Owner / QA | Review approved reference images and sign off the eight screens | Supply/locate canonical reference assets and record authorized decisions |
| P1 | Engineering | Exercise order creation/editing through the actual R010 UI and test pricing/version restrictions | Existing order API works in synthetic test; UI create path not browser-tested |
| P2 | Security / Operations | Qualify session expiry/recovery, trusted-device behavior and screen-reader/contrast controls | Dedicated auth and accessibility review |
| P2 | Operations / Clinical / Finance | Resolve clinical, identity, diagnostic pricing and legal billing approvals | Required before enabling corresponding restricted transitions |
| P2 | Release Engineering | Qualify persistent DB migration and recovery, malware scanning, and credential rotation | Protected tasks remain unmodified and unqualified |

## Preservation and Git

The repo remains on `master` at `872eeebfd05adc30edb90490bbe4d3b2369add91`, with accumulated work preserved and uncommitted. No commit, push, merge, rebase, deployment, persistent database migration, or provider activation was performed. Restricted preservation snapshot: `F:\Rudra Health Care Centre\Rudra Health OS Audit\Batch1_Final_Preservation_2026-11-17_R1`; 249 files in both snapshot and separate restore-check copy, 498 SHA-256 comparisons, zero mismatches. Access is limited to the current user, SYSTEM and Administrators. The external eight-screen evidence overlay is `F:\Rudra Health Care Centre\Rudra Health OS Audit\Rudra_Health_OS_Acceptance_Batch1_2026-11-17.csv`.

