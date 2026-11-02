# P2-08 — Diagnostic Reports, Delivery & Follow-ups

## Status

Implemented for synthetic-data local development. Report intake, metadata, event history, follow-up tasks, and private attachment handling are connected to the existing staff authentication, centre permissions, PostgreSQL, audit chain, Patient 360°, orders, and appointments.

This is not authorization to use actual patient reports. Application-level encryption and production storage qualification remain incomplete.

## Screens and routes

- `/reports` — report operations dashboard and status counts.
- `/reports/directory` — centre-filtered report directory.
- `/reports/pending` — awaiting, quarantined, and verification-pending reports.
- `/reports/new` — register a manual report intake against a confirmed order.
- `/reports/[id]` — report details, version history, attachment status, protected preview/download when scan-clean, verification, release, delivery, hold, exception, correction, and event history.
- `/reports/verification` — reports awaiting verification.
- `/reports/delivery` — release and delivery register.
- `/reports/exceptions` — held, quarantined, and exception reports.
- `/reports/followups` and `/reports/followups/new` — internal report-related task directory and creation.
- `/reports/followups/overdue` — overdue internal follow-up tasks.
- Report status history is linked from Patient 360°, Order Details, and Appointment Details. Family membership does not grant report access.

## APIs and migrations

- `GET/POST /api/reports` — centre-scoped report listing, manual intake, verification, release approval, holds, exception handling, staff-mediated delivery, and correction version creation.
- `GET /api/reports/[id]` — report metadata, versions, attachment metadata, report events, and delivery history.
- `GET/POST /api/reports/[id]/documents` — protected attachment access and upload.
- `POST /api/reports/history` — patient/order/appointment report history, with each source permission plus report permission.
- `GET/POST /api/report-followups` — internal tasks, assignment, rescheduling, completion, unsuccessful outcome, cancellation, and history.
- Migrations `0020_report_management.sql` through `0022_exception_resolution_guard.sql` add report records, private document metadata, append-only report and delivery events, internal report follow-ups, role grants, idempotency records, and database lifecycle guards. The migration runner verified 22 migrations in total.

Permissions are server-checked and centre-scoped: `reports.read`, `reports.register`, `reports.document.upload`, `reports.verify`, `reports.release`, `reports.deliver`, `reports.followups.manage`, and `reports.exceptions.manage`. Release requires a different staff member from the verifier. Verification requires a different staff member from the uploader and a clean scan of the latest attachment.

## Storage and workflow boundaries

- Development-only storage is outside the public web root at the fixed `var/private-reports` path. The storage helper rejects paths under `public/`; production-mode writes are blocked.
- Uploads accept PDF files up to 10 MB, check the PDF signature and end marker, sanitize stored filenames, use opaque storage keys, and persist SHA-256 checksums. Responses use private/no-store headers and generated filenames; document access is audited.
- An optional ClamAV INSTREAM adapter uses `REPORT_CLAMAV_HOST` and `REPORT_CLAMAV_PORT`. The scanner is not configured for this local project. Uploads are retained in `QUARANTINED` state and cannot be previewed, downloaded, verified, or released until a trusted scan returns clean. Scanner errors also quarantine.
- Storage is not application-encrypted, and Windows filesystem ACLs, backups, retention, malware-scanner deployment, and production object storage have not been qualified. Keep report files synthetic.
- Manual intake records an external reference only when staff supplies one; this does not verify a Metropolis-originated report. Verification checks document provenance and patient/order identity, not clinical interpretation.
- Release approval is distinct from delivery. Delivery is limited to a manually recorded physical collection or authorized staff handoff with recipient verification and acknowledgment evidence. No public links, portal, email, SMS, WhatsApp, or external transmission are enabled.
- Corrections create a new version and supersede the prior released version. Report event and document metadata history is append-only. Exceptions require a reason and can be resolved back to verification or quarantine depending on the latest scan state.
- Follow-ups are internal reminders. They do not send messages or calls and do not override contact or marketing consent.
- Laboratory findings, result interpretation, critical-value escalation thresholds, recollection protocols, and verified clinical procedures are outside this milestone.

## Verification results (2026-10-29)

- `npm.cmd run lint` — passed.
- `npm.cmd run typecheck` — passed.
- `npm.cmd test` — passed: **33 test files, 101 tests**. Includes report API authentication/CSRF boundaries, transition/separation-of-duty rules, PDF storage validation, and fail-closed scanner behavior.
- `npm.cmd run db:migrate` — passed; 22 migrations applied/verified, including a clean replay.
- `npm.cmd run db:integration` — passed on the dedicated PostgreSQL test database with synthetic rows and rollback. Report intake persistence, scan-quarantine verification rejection, append-only report/document metadata, follow-up completion, migration replay, and runtime-role privileges passed alongside prior modules.
- `npm.cmd run db:verify-audit` — passed; local audit chain verified (1 event at final check).
- `npm.cmd run build` — passed; production build generated all report pages and APIs with no file-tracing warnings.
- `npm.cmd audit --audit-level=low` — passed; 0 vulnerabilities reported.
- `npm.cmd ci --dry-run --ignore-scripts` — passed; lockfile resolved without install changes.

## Acceptance gates still open

- Authenticated browser workflow and direct unauthorized/MFA-incomplete/cross-centre HTTP acceptance were not run. Desktop/mobile visual review remains pending; browser restrictions were not bypassed.
- ClamAV was unavailable, so a CLEAN file, protected preview/download, report verification, release approval, and acknowledged-delivery sequence were not exercised end to end.
- Application-level encryption, secure production storage, malware scanner operations, patient portal access, external delivery channels, and actual clinical procedures are not implemented or qualified.
- No live Metropolis report, real report document, patient notification, clinical interpretation, or production deployment was used.

## Next milestone

Prioritize a consolidated Security, Privacy & Browser Acceptance milestone before real records or clinical documents are introduced. Keep P2-08 in synthetic-data development until encryption, storage controls, scanner qualification, and authenticated authorization acceptance pass.

Final security review: idempotent report, document-upload, and follow-up replays re-check the original record's centre authorization before returning identifiers or status. Final verification rerun passed: lint, TypeScript, 33 test files / 101 tests, PostgreSQL migration replay (22 migrations), integration checks, audit-chain verification, production build, dependency audit (0 vulnerabilities), and lockfile dry-run.
