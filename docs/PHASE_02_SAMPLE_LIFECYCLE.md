# P2-06 — Home Collection, Sample Management & Chain of Custody

## Status

Implemented for synthetic-data local development. This is not clinical procedure approval, production qualification, or authorization to enter real patient information.

## Delivered

- New specimens created by the collection API require the assigned collector to submit a handover request before they appear in the Rudra receiving queue. This creates a separate `SUBMITTED_FOR_RECEIVING` custody event; it is not a receiving acknowledgment. The field handover queue has a minimal projection, and the submission action is idempotent. Migration `0093_sample_receiving_submission.sql` adds the compatibility flag and custody-event key. Dedicated PostgreSQL integration replay verified this schema path; migration 0093 has since been applied additively to the persistent local development database without resetting or rewriting application records.

- Collection operations, eligible appointment/order selection, collection job detail, and phlebotomist daily assignment routes.
- Centre-scoped collection job creation, assignment/reassignment, schedule conflict checks, visit start/arrival/failed attempt/cancellation, and explicit visit completion after at least one specimen is recorded.
- Sample directory and detail with operational history; specimen capture requires an active, centre-scoped approved procedure reference and a staff identity-check attestation.
- Rudra receiving, sample exceptions, authorized recollection requests, dispatch batch creation, handover recording, and manual external receipt evidence recording.
- Patient, appointment, and diagnostic order histories link to sample events where the viewer has the relevant permission.
- New APIs under `/api/collections` and `/api/samples`; responsive workbench pages under `/collections`, `/field/today`, `/samples`, `/branch/receiving`, and `/branch/dispatch`.
- Migration `0014_collection_sample_custody.sql` adds collection jobs/events, specimen records, procedure-reference approvals, dispatch batches/items, manual receipt records, exceptions, permissions, and append-only protections.
- The sample directory omits patient identity fields unless the viewer also has `patients.read`; assigned collectors see only their assigned jobs under the existing centre boundary.

## Operational safety boundaries

- Appointment/order eligibility requires a confirmed appointment and a confirmed order linked to that appointment. Collection work does not itself complete an order.
- Collection, receiving, packing, and transport actions are blocked until a centre-scoped active procedure reference is configured. The software does not provide clinical instructions or determine specimen suitability.
- The configured reference is a record of an externally approved procedure; its existence does not independently verify its content. The centre must validate procedures and specimen requirements against authorized clinical/Metropolis sources before operational use.
- External laboratory receipt is recorded manually with evidence provenance. There is no Metropolis API integration, fabricated accession number, or automatic lab status.
- No sample processing, report creation, billing, patient messaging, or clinical interpretation is implemented here.
- Append-only history rows reject update/delete grants and are protected by database triggers. Corrections are represented through later records rather than rewriting custody events.

## Verification results (2026-10-29)

- `npm.cmd run lint` — passed.
- `npm.cmd run typecheck` — passed.
- `npm.cmd test` — passed: 28 files, 85 tests.
- `npm.cmd run db:migrate` — passed; 0 new migrations applied, 14 total verified.
- `npm.cmd run db:integration` — passed against local PostgreSQL with synthetic fixtures. Migration replay, collection job/specimen idempotency, receive/pack/dispatch, manually recorded external receipt, append-only history, existing RBAC and audit verification passed. Runtime-role privilege checks passed for collection/sample operations and append-only restrictions.
- `npm.cmd run db:verify-audit` — passed; audit chain verified (1 event in the current local database).
- `npm.cmd run build` — passed; Next.js production build generated routes successfully.
- `npm.cmd audit --audit-level=low` — passed; 0 vulnerabilities reported.

## Not verified / acceptance gates

- Direct live HTTP attempts using unauthenticated, MFA-incomplete, unauthorized-role, and cross-centre sessions were not run in this qualification.
- Authenticated desktop/mobile browser review was not performed. Existing saved browser permission limitations remain in effect; no bypass was attempted.
- No independently validated Rudra/Metropolis operating procedure references, specimen requirements, temperatures, stability limits, or transport rules were supplied. Therefore operational actions must remain unused until approved references are reviewed and registered by an authorized operator.
- Application-level encryption remains incomplete. Use synthetic data only; no production deployment or real patient data.
- No real Metropolis integration or independent laboratory receipt confirmation was tested.

## Next milestone

P2-07 — Payments & Billing, after the separate security, privacy, pricing, and operational acceptance gates are reviewed. Do not infer billing or payment from an appointment, order, collection, dispatch, or manual receipt record.
