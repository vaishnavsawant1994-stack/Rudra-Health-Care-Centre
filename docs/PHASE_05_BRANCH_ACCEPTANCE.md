# Phase 05 â€” Branch, Sample Logistics, Lab & Reports

**Checkpoint:** 14 November 2026. **State:** development checkpoint; manual screen acceptance pending. **Data:** synthetic only. **External lab:** manual-first; no live Metropolis provider connection is configured.

## Stabilization addendum — 14 November 2026

Read-only metadata inspection found the local loopback application and migration targets at migration 0093, with no checksum mismatches and migrations 0094–0099 pending. No local DB migration was applied. Backup/restore qualification remains open. See [`PHASE_05_06_READINESS.md`](PHASE_05_06_READINESS.md) for migration preflight risks and the exact database evidence.

Added isolated synthetic PostgreSQL concurrency coverage for manual reference mapping and status events. It serializes matching idempotency retries, verifies organization-wide reference collision across centres, rejects changed occurrence-time reuse, permits only one append-only correction successor, checks audit persistence, denies unauthorized writes and keeps provider-like status values rejected. Focused test result: 15/15 across five files. No external Metropolis operation was enabled. All 17 screens remain pending final screen/browser acceptance.

This register distinguishes code presence from tested behavior and final acceptance. The route inventory in `SCREEN_IMPLEMENTATION_MATRIX.csv` preserves the canonical screen IDs, names, and routes. The Phase 05 overlay in the external audit folder carries the same 17 screen records.

| ID | Screen / canonical route | Development evidence and current limit | QA evidence / acceptance |
|---|---|---|---|
| L001 | Branch operations overview â€” `/branch` | Protected centre operations summary with links into receipt, dispatch, reports and exceptions; derives only existing operational queues. | Reuses branch summary tests; per-screen visual/manual review pending. |
| L002 | Sample queue / scan station â€” `/branch/samples` | Centre-scoped sample directory. Text lookup is not represented as barcode scanning; scan hardware and label policy remain unapproved. | Existing sample API tests; barcode and screen-specific tests pending. |
| L003 | Branch sample receiving â€” `/branch/receive` | Existing receipt workflow; physical custody is distinct from field collection and submitted handover. | Existing sample receipt tests; end-to-end browser run pending. |
| L004 | Sample condition & rejection review â€” `/branch/quality-check` | Existing exception/deviation workflows with authorized SOP reference; no new clinical interpretation. | Existing exception API evidence; approved SOP and manual workflow review pending. |
| L005 | Dispatch planning & batches â€” `/branch/dispatch` | Reuses protected dispatch batch workflow and sample eligibility checks. | Existing dispatch API tests; full custody journey test pending. |
| L006 | Driver / courier handover â€” `/branch/handover` | Shows recorded handover queue and protected batch details; requires recorded custody evidence. | Existing dispatch route evidence; driver/hardware acceptance pending. |
| L007 | In-transit shipment tracking â€” `/branch/transit` | Lists recorded shipment/custody states only. No GPS, courier acknowledgement, temperature compliance or lab receipt is fabricated. | Existing custody tests; no transport provider integration test. |
| L008 | Metropolis reference mapping â€” `/integrations/metropolis/links` | New encrypted manual mapping API; HMAC blind index collision check, idempotency key, centre/order/specimen checks and immutable audit event. No partner verification claim. | Policy/crypto focused tests added; API/PostgreSQL route integration pending. |
| L009 | Manual Metropolis status updates â€” `/integrations/metropolis/status` | New staff-recorded status events, external occurrence time, actor/recording time, encrypted evidence/reason, independent review, append-only correction history. Source remains `STAFF_RECORDED`. | Policy/crypto focused tests added; route authorization, collision and replay database tests pending. |
| L010 | Rejection & recollection queue â€” `/branch/recollection` | Existing sample exception/recollection request workflow; no automatic patient communication or new job creation. | Existing sample exception tests; end-to-end reassignment/conversion acceptance pending. |
| L011 | Partner lab receipt & processing â€” `/branch/lab-progress` | Displays manually entered milestones and independent documentary review. No live Metropolis state is claimed. | Shared manual status policy tests; live integration is not configured. |
| L012 | Metropolis import & validation â€” `/integrations/metropolis/imports` | Upload/import is explicitly disabled because no authorized CSV schema, data-use contract or validation rules exist. | Restricted-state check; import behavior is not enabled or tested. |
| L013 | Report intake & secure linking â€” `/branch/reports/intake` | Reuses encrypted report intake, order linkage, provenance, quarantine and audit workflows. Draft/upload is not release. | Existing report route tests; provenance/clean scan and role checks require complete focused review. |
| L014 | Report availability & delivery â€” `/branch/reports/deliver` | Existing staff-mediated delivery workflow. Electronic delivery stays disabled; document reads are denied for held, quarantined, exception and superseded records. | Report-policy unit assertion added; full API tests pending. Patient-facing release remains gated. |
| L015 | Partial reports, corrections & revocations â€” `/branch/reports/exceptions` | Reuses versioned corrections and revocation history; prior records remain retained and restricted. No automatic delivery notification. | Existing report workflow evidence; exhaustive access-revocation integration testing pending. |
| L016 | Operational order journey â€” `/staff/orders/:id/journey` | New authorized composition of order detail, collection/custody, external evidence and linked report history. Events are sourced from persisted records; no inferred lab milestone. | Uses existing order/sample/report tests and new status policy tests; cross-module journey integration pending. |
| L017 | Critical results & urgent escalation â€” `/branch/critical-alerts` | Protected restricted state. No thresholds, qualified-person routing, patient notification or acknowledgement actions are enabled without approved clinical policy. | Restriction is documented in route source; no clinical workflow test or acceptance. |

## Changes in this checkpoint

- Added migration `0099_metropolis_manual_evidence.sql` and Drizzle schema entries for encrypted reference mappings, append-only manually recorded status events, and independent review records. The migration has not been applied to a persistent development or production database.
- Added protected Metropolis reference/order/status endpoints. Requests require existing sample integration permission and centre scope; public and patient endpoints were not added. Metropolis references, evidence references and reasons are encrypted. A keyed blind index supports organization-wide collision checks without storing the raw external value in the index.
- Added exact idempotent replay checks for reference/status/review requests and immutable correction records. A correction appends a new status event linked to its predecessor.
- Restricted report document GET for held, quarantined, exceptional and superseded reports.
- Added canonical L001â€“L017 route files/navigation; route presence is not functional acceptance.
- Added policy and blind-index unit tests. The new integration routes still need database-backed API coverage for role/centre denial, collisions, idempotency, independent review and correction concurrency.

## Verification and limits

Verification completed for this checkpoint: the focused Phase 05/reconciliation suite passed **30/30 across six files**; the full Vitest suite passed **916/916 across 225 files**; ESLint and TypeScript passed; isolated PostgreSQL integration replayed **99 migrations** and its synthetic database checks passed; production build passed and generated **346 static pages**. The separate `db:integration` command then failed in its runtime-role portion because the loopback development database `rudra_health_dev` is behind at migration 0093 and does not yet have the new/required tables. No persistent database was migrated.

No Phase 05 complete/finally accepted screen is claimed. Manual responsive, accessibility, visual comparison with L001/C001, and device/browser acceptance remain pending. New Metropolis endpoints still need database-backed API tests for role/centre denial, idempotency races, collision handling, independent review and correction concurrency.

Outstanding readiness blockers: local development database schema is at migration 0093 while source requires 0099; do not mark local run-ready until the six pending migrations have been applied through the approved development migration process. Approved barcode/labeling procedure and hardware; approved deviation/rejection SOP; Metropolis authorization, CSV schema and provider contract; approved report release, recipient verification and electronic delivery policy; approved critical-result thresholds, qualified staff roster and escalation/acknowledgement protocol are also pending. Pending external decisions remain disabled.

The existing Phase 03 and Phase 04 uncommitted changes have been preserved. No commit, push, deployment, production data access or production database change was made.


## Wave 3 upstream workflow boundary — 15 November 2026

The connected public-enquiry workflow does not progress to branch custody because its synthetic catalogue order remains pending price verification, and no collection job is created. Existing manual-first Metropolis evidence remains staff-entered and separately reviewable; this Wave 3 integration test did not record an external lab status, accept provider confirmation, create a report, or release a result.

## Wave 4 custody and dispatch integration evidence — 15 November 2026

The existing disposable PostgreSQL integration suite now covers a synthetic specimen from handover submission through branch receipt, batch packing, batch creation, and simulated staff-recorded carrier handover. It checks append-only custody event order, duplicate batch rejection, stale-version rejection on repeated handover, final `DISPATCHED` state, and absence of any external receipt. Packing and transport references are test-only fixtures, not approved SOPs or transport procedures. This starts from a test-only collected specimen and does not establish physical collection, confirm a real appointment or order, or prove carrier/laboratory receipt. Focused PostgreSQL suite passed 33/33; full Vitest passed 956/956 across 240 files. All L001–L017 remain pending screen-level manual acceptance.
