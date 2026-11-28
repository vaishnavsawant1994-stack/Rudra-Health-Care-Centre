# Master Closeout Wave 8 - Finance, Authentication and Report Security

**Date:** 16 November 2026  
**Repository:** `F:\Rudra Health Care Centre\rudra-health-os`  
**Git:** `master` at `872eeebfd05adc30edb90490bbe4d3b2369add91`; no commit, push, merge, rebase or deployment.  
**Classification:** Development evidence only. The 178-screen totals remain 151 partial, 27 restricted, 0 complete, 0 finally accepted.

## Scope and safeguards

Wave 8 extends the prior synthetic, route-handler/PostgreSQL journey through the existing finance APIs and adds a genuine Better Auth session/TOTP test. Both PostgreSQL integration paths use dedicated, random disposable schemas in the test database and drop those schemas afterward. The persistent development database was not connected to or changed. No production data, real patient/staff identity, external provider, legal invoice, payment settlement, report release, Metropolis confirmation, source migration, role change, credential rotation or deployment occurred.

The original worktree was preserved. At the start of Wave 8, `git status --porcelain` had 145 entries (tracked modified files plus untracked file/directory entries); this count is not the same as the preservation file count because untracked directories contain multiple files. Existing Wave 7 preservation snapshot R2 contains 197 source files and previously passed 394/394 source/restore hash comparisons. Its ACL initially prevented the owner from reading manifest entries; explicit owner, SYSTEM and Administrators ACLs were applied recursively without changing content, after which all 394 checks passed. Wave 8 creates a new restricted preservation snapshot at completion.

## Continuous synthetic operational journey

The same enquiry-derived order and appointment from `src/app/api/public/enquiries/route.db.integration.test.ts` now continue into the actual finance route handlers. The test uses a mocked access resolver with synthetic scoped grants for that continuous business-flow test; authentication is independently exercised in the session integration test below.

| Stage | Route / evidence | Verified outcome | Limit |
|---|---|---|---|
| Enquiry through order | Public enquiry, CRM, patient conversion, requested appointment, synthetic catalogue approval and order handlers | Existing Wave 7 joined flow remains linked and idempotent | Synthetic catalogue transition; not a genuine identity, clinical or commercial approval |
| Collection and branch | Collection job, collector, arrival, collection, custody, branch receipt, packing and internal dispatch APIs | Persisted state transitions and audit/custody chain | Test grants and synthetic records; no physical act or external laboratory/carrier receipt |
| Finance charges | `POST /api/finance` `create_order_charges` | Same confirmed test order and appointment create distinct INR 450.00 diagnostic and INR 99.00 requested home-collection charge snapshots; duplicate create creates no additional charge | Internal snapshot only; issuer is PENDING and `legalInvoice=false`; no tax/legal invoice |
| Partial payment | `POST /api/finance` `record_payment` and `payment_decision` | INR 200.00 synthetic cash evidence is idempotent and internally reviewed; it is not described as settlement | Staff-entered evidence is not bank, UPI, gateway or provider verification |
| Dispute and balance | Finance summary | Separate INR 10.00 payment marked disputed; diagnostic balance and combined order outstanding amount calculate correctly; total combined charges INR 549.00, payment evidence applied INR 200.00, outstanding INR 349.00 | No refund, credit note, external reconciliation or settlement |
| Reconciliation | `open_reconciliation`, `close_reconciliation` | Reconciliation opened before evidence; separate synthetic closer closes with expected/counted INR 200.00, zero variance; audit records verified | Internal cash count only; no bank/UPI statement matching |
| Report document | Existing report document API in joined test | Harmless test PDF encrypted in temporary private storage; unavailable scanner fails closed into quarantine; wrong-centre read denied | No release/delivery; real ClamAV service/signature qualification remains pending |

All amounts are INR minor-unit integers in the assertions. Diagnostic catalogue price and Rudra collection fee remain separate historical charge rows; charge creation is idempotent. The payment status is an internal decision and must not be used as a provider settlement claim.

## Real authentication and authorization evidence

New test: `src/server/access.session.db.integration.test.ts`. It calls the actual Better Auth catch-all route for sign-in, TOTP enrollment/verification and sign-out, then calls the real `getApiAccess` resolver and actual finance/report route handlers. It seeds a synthetic user/staff account and centre-specific `finance.read` grant in its own migrated disposable PostgreSQL schema. The only injected piece is `next/headers` request-header sourcing required by the route-handler test harness; authentication, Better Auth routes, session persistence, MFA session stamping, RBAC and centre authorization are not mocked.

Verified: anonymous request returns 401; password sign-in issues a real session; the unverified TOTP session is denied with 428; actual TOTP verification enables MFA and stamps the authenticated session; authorized finance reads succeed; wrong-centre and wrong-role operations are denied; report list is denied without `reports.read`; missing-origin protected POST is rejected by CSRF; sign-out invalidates the session; and an expired session is denied. The test uses a random synthetic password/secret and restores prior process environment values, then drops the isolated schema.

This is genuine Better Auth/session-backed **route-handler integration**, not a running Next.js HTTP-server test, browser login, manual interaction, visual acceptance or production authentication acceptance. MFA trusted-device behavior is not covered by this Wave 8 test.

## Report security and scanner qualification

The full suite includes actual report document API authorization tests, encrypted storage tests with disposable keys and isolated temporary private storage, and the joined report upload/quarantine scenario. Current evidence supports encrypted-at-rest behavior for the exercised file-storage helper, link to the synthetic report/order, role/centre restrictions, and fail-closed handling when scanner configuration is unavailable. Existing fake local INSTREAM protocol servers exercise protocol parsing/handling only. No actual ClamAV binary, signature database or approved scanning service was found listening on local port 3310 at inspection time. Real malware scanning, scanner timeout under production service conditions, complete corrections/revocation/supersession lifecycle, combined database/private-file/historical-key restoration, and clinical release remain unqualified.

No customer report is delivered, approved or released by these tests.

## Verification results

- **Full Vitest:** 960/960 passed across 242 files after the final test-only environment restoration adjustment.
- **Focused Wave 8 session + joined journey:** 18/18 passed across two files after the final test adjustment (one session test and 17 public-enquiry integration tests).
- **Focused session test:** 1/1 passed, including sign-in/TOTP, role/centre, CSRF, sign-out and expiry cases.
- **ESLint:** passed.
- **TypeScript:** passed after replacing ES2017-incompatible BigInt literals in test assertions.
- **Production build:** passed after the BigInt correction; Next generated 406 static/partial-prerender entries. No deployment occurred.
- **ClamAV availability probe:** no listener found on local TCP 3310; no real scanner claimed.
- **Inventory:** 178 canonical IDs preserved and 12 affected rows updated. The source reconciliation generator was not run because its current generation path hard-codes Wave 4 verification evidence and would overwrite stronger Wave 7 rows; its tests were included in the full suite. Canonical row count and overlay count were checked directly. Implementation and acceptance categories were not promoted.
- **HTTP server/browser:** not executed. Previous runtime command was blocked by execution policy. No policy bypass or browser host workaround was attempted.
- **Persistent DB / migration / credential:** not touched.

## Remaining blockers and next priorities

1. Test payment correction/refund lifecycles and concurrency against the same documented synthetic contracts, while keeping settlement status internal and provider-neutral.
2. Obtain controlled authenticated HTTP/browser test infrastructure; keep these results distinct from handler integration and perform manual Owner/QA acceptance for each screen.
3. Qualify an approved real scanner in isolated infrastructure; otherwise retain quarantine as the only safe status.
4. Exercise report supersession, revocation, scanner timeout, storage cleanup, access audit and restore with disposable files/keys and schemas.
5. Qualify persistent development DB migration 0093 to source migration 0100 separately, with an approved backup and restore rehearsal; do not run the public-schema integration script as a shortcut.
6. Keep legal issuer/tax policy, provider settlement, Metropolis permissions, physical clinical SOP, identity proofing, privacy policy, backup/key recovery and Owner/QA sign-off as explicit blockers.

## Change list for Wave 8

- `src/app/api/public/enquiries/route.db.integration.test.ts` - extends the existing joined synthetic workflow through the existing finance API, payment evidence, disputed state, outstanding balance and separation-of-duties reconciliation.
- `src/server/access.session.db.integration.test.ts` - exercises actual Better Auth session/TOTP and authorization against a disposable schema.
- `docs/SCREEN_IMPLEMENTATION_MATRIX.csv` and `docs/SCREEN_IMPLEMENTATION_MATRIX.md` - append bounded evidence to affected canonical rows and matrix summary; no acceptance/status promotion.
- `docs/MASTER_DEVELOPMENT_TRACKER.md` - records Wave 8 outcome.
- `docs/MASTER_CLOSEOUT_WAVE8_2026-11-16.md` - this closeout report.
- External overlay: `Rudra_Health_OS_Wave8_178_Screen_Overlay_2026-11-16.csv` in the audit folder.

No application behavior, schema migration, persistent database, provider configuration, legal invoice, actual settlement, report release, commit, push, merge, rebase or deployment changed.


## Final preservation snapshot

The final restricted snapshot is `F:\Rudra Health Care Centre\Rudra Health OS Audit\Wave8_Final_Preservation_2026-11-16_R1`. It contains **199 changed/untracked repository files**, plus a separate restore-check copy and the SHA-256 manifest. Both copies passed **398/398** hash comparisons with **0 mismatches**. ACLs were explicitly restricted to the current owner, SYSTEM and local Administrators. `.env*`, private report storage, key files, `.git` and `.next` were excluded. The repository has **146 default porcelain entries** at snapshot time, versus 199 expanded changed/untracked files; the counts differ because Git's default status collapses untracked directories. There are **0 staged files**.
