# Field and branch browser evidence — 22 November 2026

This records only the checks performed in the isolated synthetic runtime. It is not Owner/QA acceptance or production qualification.

## Results

| Screen | Browser evidence | Remaining before technical completion |
| --- | --- | --- |
| F001 — Field Today | Synthetic field staff signed in with Better Auth and completed TOTP. Page rendered; collection queue, authorized centres and procedures returned HTTP 200. After the permission fix, a field-only user no longer requests `/api/collections/eligible` (which requires `collections.assign`). | No job records/actions, error/retry, keyboard, tablet, or approved visual comparison verified. |
| F002 — Collection Dispatch | Authenticated page rendered at the canonical route, redirected to `/collections`; synthetic field user could switch between their two authorized centres. At 390×844, no horizontal overflow was observed. | No populated queue, pagination, assignment action, stale-response/error recovery, keyboard, tablet, or visual comparison verified. |
| F011 — Field Handover | Authenticated empty state rendered and correctly described a handover request as distinct from physical receiving. | No populated handover or mutation tested. |
| L003 — Branch Receiving | Not browser-verified. The synthetic receiving account's TOTP enrollment/verification was rejected, so no authorized receiver session was established. | Receiver MFA test fixture/session and permitted receiving procedure remain prerequisites. No specimen was seeded or physically received. |

No collection, physical receipt, courier acceptance, or external Metropolis milestone was represented as completed. No patient data was used.

## Source change

Field-only roles were causing an unnecessary request to the assignment-only eligible-jobs endpoint. The UI now requests eligible jobs only if the current grants include `collections.assign`; the API remains the authorization boundary. Added a permission-helper regression test. Files: `src/components/samples/sample-workbench.tsx`, `src/lib/sample-operations-permissions.ts`, and `src/lib/sample-operations-permissions.test.ts`.

## Verification

- Focused permission/query tests: 8 passed.
- Inventory reconciliation tests: 23 passed.
- Full Vitest run: 992 passed, 18 skipped, 3 PostgreSQL integration suites failed during setup/teardown timeouts/deadlock under parallel load. The three affected suites passed when rerun serially: 23/23. The full suite is therefore not reported as green.
- ESLint: passed.
- TypeScript: passed.
- Production build: passed; 406 generated routes.
- `git diff --check`: passed.
- Full Playwright acceptance for F001/F002/F011/L003: not completed. Tablet, keyboard/accessibility, data-bearing actions, pagination and visual parity remain unverified.

## Temporary test infrastructure cleanup

The isolated Next.js server was stopped. The generated `rudra_health_test` schema and external runtime `.env.local` still require cleanup. The exact schema/database/role identity was checked before cleanup; the platform execution policy rejected the schema-drop and file-removal commands. No alternate execution path was used. The persistent development database was not targeted. Remove the disposable schema and runtime credentials through an authorized cleanup channel before reusing this environment.

## Screen dispositions

All four screens remain **partially implemented**. F001, F002 and F011 have limited authenticated browser evidence as described above; L003 has none from this run. No screen qualifies as technically complete or Owner/QA accepted based on this evidence.
