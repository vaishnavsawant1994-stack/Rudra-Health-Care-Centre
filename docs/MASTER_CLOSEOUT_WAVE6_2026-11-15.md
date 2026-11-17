# Master Closeout Wave 6 — Isolated Acceptance and Document Security

**Date:** 15 November 2026  
**Repository:** `master`; existing HEAD remains `872eeebfd05adc30edb90490bbe4d3b2369add91`. All prior project work remains uncommitted and preserved.  
**Status:** partial development checkpoint. Browser acceptance and continuous full operational journey remain unverified.

## Isolation verification

- Sanitized configuration checks confirmed `DATABASE_URL` points to the distinct local loopback database `rudra_health_dev` and `DATABASE_TEST_URL` to distinct local loopback database `rudra_health_test`. The test database uses the same local host and login identity; the application child process received only the test database URL and a unique `p2_09a_wave6_...` search path. No `rudra_health_dev` URL was passed to the application.
- A disposable schema in `rudra_health_test` was created, migrated through **100/100** source migrations and dropped after acceptance-environment preparation. No persistent development database migration or write was performed.
- A temporary application copy under the OS temp directory excluded `.env.local`, `.env`, private report files and Git objects. Its `node_modules` were copied physically so Turbopack resolved packages inside the isolated project. The Next dev server reached “Ready” on loopback, then was stopped without issuing application requests. Its process environment included generated throwaway auth/encryption keys, no provider credentials, and the isolated test-schema database URL.
- The CUA browser inventory returned no browser/native app surfaces because the browser access host was unavailable. No browser navigation, sign-in, API-backed UI workflow, screenshot or responsive interaction was performed. The app was not run against an unverified database; actual browser acceptance is blocked by unavailable browser tooling in this session.

## Document-security changes and verification

- `src/server/report-storage.ts` now accepts `REPORT_PRIVATE_STORAGE_DIR` in non-production to allow explicitly isolated private storage. Production storage remains blocked pending qualification. The resolved path is still rejected if it equals or sits under the public directory.
- `src/server/report-storage.test.ts` stores a harmless synthetic PDF in an OS temporary directory using test-only encryption material, confirms ciphertext does not contain the document bytes, decrypts with the expected key ID, removes the file and rejects a public-directory storage path.
- `src/app/api/reports/[id]/documents/route.ts` now checks centre-scoped `reports.read` authorization before returning a quarantine/revocation status. This prevents an unauthorized centre reader from learning that a specific report is quarantined.
- `src/app/api/reports/[id]/documents/route.test.ts` verifies wrong-centre denial occurs before status disclosure and authorized readers still receive `423` for quarantined documents.
- Focused report storage, report crypto and report route tests passed **19/19 across four files**. The storage suite runs a synthetic local TCP server to test scanner protocol parsing and fail-closed outcomes. This does not qualify an installed ClamAV scanner, antivirus signatures, host configuration, or malware protection in production.
- Final verification after the Wave 6 source changes: full Vitest **959/959 across 241 files**; inventory reconciliation tests **19/19**; ESLint and TypeScript passed; production build passed with **406 generated route entries**; `scripts/reconcile-screen-inventory.mjs` produced 178 canonical rows; `git diff --check` passed with line-ending normalization warnings only.
- No report-document route/database integration, real report, medical result, report correction, patient delivery, external report release, key recovery or file backup/restore test was performed in this wave.

## Operational journey boundary

No new continuous enquiry-to-dispatch PostgreSQL path was added in this wave. The existing Wave 3 synthetic enquiry/CRM conversion and appointment/order journey still ends at the deliberately unverified catalogue price gate. Wave 4 custody/dispatch still begins with an already-collected synthetic specimen; Wave 5 verifies the dispatch optimistic-concurrency race. Unit and source evidence from these segments does not make a joined patient-to-field workflow.

No verified catalogue approval, appointment capacity, patient identity check, clinical SOP, physical collection, real carrier acceptance, external Metropolis receipt, lab processing, report result, legal invoice, payment settlement or patient report access is claimed. A test-only catalogue/clinical fixture cannot authorize real-world use.

## Browser and authentication acceptance

No supported Playwright/Puppeteer package is installed. CUA could not enumerate a browser, and therefore there is no evidence for sign-in, MFA, expired sessions, authenticated reception/field/branch/report/finance screen actions, loading/error states, responsive layout or screenshot parity. The Next server boot in the temp copy is not a browser test. The temporary app was stopped; the disposable database schema was removed.

## Database and credential status

- The persistent development database was not contacted by the Wave 6 app process and remains at the previously observed migration 0093; source migrations remain through 0100. No persistent DB migration or data change was made.
- `docs/DEVELOPMENT_DB_CREDENTIAL_ROTATION_RUNBOOK.md` was reviewed. Credential rotation remains **not performed**. The runbook specifies target verification, recovery checkpoint, safe password generation, interactive secret entry, local secret-store update, new/old credential verification without displaying values, transcript cleanup and Git scan. No credential value is included here. Rotation requires its own approved local maintenance step and must not be inferred from this wave.
- Database, document and encryption-key recovery qualification remain open.

## Screen inventory

Canonical IDs/names/routes remain intact. The inventory remains **178 screens: 151 partial, 27 restricted, 0 complete, 0 accepted**; **178/178** remain pending manual desktop/mobile, accessibility and Owner/QA acceptance. The new document tests add backend QA evidence only and do not promote report screens to complete.

## Changed files in this wave

- `src/server/report-storage.ts` — controlled non-production private storage directory.
- `src/server/report-storage.test.ts` — isolated storage, ciphertext and public-path guard tests.
- `src/app/api/reports/[id]/documents/route.ts` — centre authorization before report-state disclosure.
- `src/app/api/reports/[id]/documents/route.test.ts` — centre-scope and quarantine regression tests.
- This report and the Wave 6 tracker entry.

No migration, production configuration, persistent database, provider, user credential, external communication, commit, push or deployment was changed.

## Next priorities

1. In an environment with an available browser host, repeat acceptance against a temporary source copy, dedicated test DB/schema and throwaway encryption/auth keys; test at least anonymous public enquiry and staff MFA/centre denial. Capture screenshots only after actual browser state is visible.
2. Extend the Wave 3 DB/API test through a test-only catalogue verification API, confirmed synthetic appointment/order, API-created collection job, assigned synthetic collector, arrival and specimen collection; continue through branch APIs only after the actual stage prerequisites pass. Keep operational approval gates explicitly test-only.
3. Add an isolated PostgreSQL document API test for upload, scanner-unavailable quarantine, unauthorized/wrong-centre access and immutable audit; keep file storage under an OS temporary directory and never use a live scanner service.
4. Join internal order charge, separately recorded home fee, payment evidence and reconciliation only where current policy contracts permit; no settlement or legal invoice claims.
5. Keep database credential rotation, migration qualification, key/file restore, visual/accessibility checks and Owner/QA acceptance as separate release gates.
