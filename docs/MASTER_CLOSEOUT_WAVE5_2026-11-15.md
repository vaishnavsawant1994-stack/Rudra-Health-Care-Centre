# Master Closeout Wave 5 — End-to-End Operational Integration

**Date:** 15 November 2026  
**Repository:** `master` at the existing Wave 4 HEAD plus the Wave 5 test-only change; no commit, push, rebase, merge, reset or deployment.  
**Data boundary:** synthetic test data only. PostgreSQL integration suites use disposable test schemas and drop them after execution. Persistent development database was not migrated or modified.

## Result

Wave 5 adds race-condition evidence for the existing dispatch handover API and consolidates the verified operational boundaries. The complete patient-to-report-to-finance journey is **not** complete: the Wave 3 path stops at an unverified catalogue price; Wave 4 starts with an already-collected synthetic specimen. This wave did not join those segments by bypassing catalogue, clinical, appointment-capacity or collection policy gates. No screen has been promoted to accepted.

Verification after the change: focused appointment/collection PostgreSQL integration and finance PostgreSQL integration plus report API unit tests passed **42/42** (appointment/collection **33/33**). Full Vitest passed **956/956 across 240 files**; inventory reconciliation tests passed **19/19**; ESLint and TypeScript passed; production build passed and generated **406 static route entries**; canonical inventory reconciliation wrote **178 rows**; `git diff --check` passed with only known LF/CRLF normalization warnings. These checks do not change the current screen classification or manual acceptance state.

## Ordered operational journey and evidence

| Stage | Backend contract / permission | Positive evidence | Negative evidence | Frontend | Recorded state / external status | Gate and manual acceptance |
|---|---|---|---|---|---|---|
| Public enquiry → staff review → CRM → patient → appointment request | `/api/public/enquiries`; protected lead/patient/appointment APIs and scoped grants | Wave 3 disposable DB journey verifies selection/version/fee handoff, encrypted contact, idempotency and audit | Wrong-centre appointment denied; duplicate requests replay; unverified catalogue blocks priced order and collection job | Existing booking and staff workbenches are source-backed; no isolated browser acceptance | Internal request and staff records only | Capacity, identity proof and business policies remain unverified; manual acceptance pending |
| Appointment request → diagnostic order | `/api/appointments`; `/api/orders`; `appointments.*`, `orders.*`, `patients.read` | Wave 3 records a request and order snapshot | Unverified catalogue price yields `PENDING_VERIFICATION`, no diagnostic total; collection job cannot be created | Staff order UI exists; no end-to-end browser run | Internal request/order only; not a confirmed slot | No genuine approved catalogue fixture exists outside test scope; capacity is not inferred |
| Order + appointment → collection job → assignment → acceptance → travel → arrival → specimen | `/api/collections`, `/api/collections/[id]`, `/api/samples`; collections/samples permissions and assigned collector checks | Existing integration coverage separately verifies assignment, acceptance, travel, arrival prerequisites, collection guards and completion; API validates center linkage and test-only procedure reference in isolated fixtures | Arrival-before-travel, collection-before-arrival, unauthorized collector and duplicate/state conflicts are covered in focused integration cases | Field workbench invokes protected APIs; no isolated browser-to-DB operator campaign | Internal synthetic records; a test procedure row is not a real clinical SOP or patient identity check | No genuine identity-verification/clinical SOP approval or browser/manual acceptance |
| Collected specimen → handover → branch receipt → packing → dispatch → recorded carrier handover | `/api/samples`, `/api/samples/dispatch`, `/api/samples/dispatch/[id]`; `samples.collect`, `samples.receive`, `samples.dispatch` | Wave 4 API test records distinct submission, branch receipt, packing and handover events. Wave 5 runs two identical handovers concurrently at expected version 1: one `200`, one `409 version_conflict`; one dispatch event/state transition remains | Duplicate batch after packing, stale handover, centre/role boundaries and receiving-before-submission are rejected in existing cases | Receiving/dispatch workbench actions are API-backed; no browser acceptance | `DISPATCHED` means internal staff-recorded handover. No external receipt was created | Dispatch route has no idempotency-key field. Exact committed retry is a `409`; same key replay is not a supported contract. Keep stale conflict; do not imply carrier acceptance |
| External lab receipt and processing | Dispatch receipt action requires `samples.external.verify`; manual evidence fields | No provider receipt or processing verified in this journey | External receipt row count asserted zero after internal handover | Manual-first workbench only | No external lab milestone exists | Metropolis authorization, documentary evidence and independent verification pending |
| Report intake, document custody, verification, correction, patient access | `/api/reports`; `/api/reports/[id]/documents`; report-specific grants, centre scopes and independent release checks | Source inspection confirms report registration requires a confirmed order; upload encrypts private files, records scan status and audit, and quarantines scanner-unavailable files; download requires readable report status plus clean scan/key | Quarantined documents return `423`; held/superseded/revoked status blocks document access; release requires separate approver and clean document | Protected reports workbench/API exists; no isolated browser or end-to-end report artifact test in this wave | No report/result/release/delivery created by Wave 5 | No fabricated laboratory result, clinical release, patient report access or delivery. Report integration remains unverified end to end; scanner and policy qualification pending |
| Finance record and reconciliation | `/api/finance`; `finance.*` permissions | Existing disposable finance suite verifies internal payment listing, encrypted reference access, reconciliation snapshots and close capture without asserting settlement | Sensitive references are not searchable in listings; unauthorized/invalid operations are covered in finance route tests | Finance workbench is API-backed; no browser campaign | Internal ledger evidence only; no gateway or settlement | Catalogue charge integration, refunds/disputes across a complete order lifecycle, issuer/legal policy and settlement remain unaccepted |

## Dispatch retry contract established by source and test

The handover request schema has `action`, `batchId`, `expectedVersion`, carrier reference, procedure reference and reason; it has no idempotency key. The API row-locks the batch, checks the expected version and `PREPARING` status, commits `DISPATCHED`, records staff custody events, and increments the version in one transaction. Concurrent requests with the same version serialize: one transaction commits and the next observes the changed version and returns `409 version_conflict`. A later byte-identical retry also returns `409`; there is no same-key replay behavior to test. A changed body with stale version likewise cannot append another event. Authorization and centre scoping occur before the mutation. This is safe optimistic concurrency, not an idempotent replay API. A durable replay contract would require request-key persistence and fingerprint comparison; it is not introduced here.

## Report and finance control inspection

- Report registration accepts a confirmed internal order, but that is only registration of an awaiting report, not proof a laboratory completed testing.
- Report upload persists into private storage, computes a digest, records encryption key ID and scan result, and sets `PENDING_VERIFICATION` only for a clean scan; unavailable scanning yields `QUARANTINED`. Document retrieval checks report status, centre authorization, scan result and key, and verifies the digest before returning bytes.
- Release is separately permissioned and requires an independent approver and clean scanned document. Delivery is a staff-recorded, evidence-bearing action. No upload/download storage integration was exercised in this wave; the report route unit tests alone do not qualify encryption keys, scanner operation, filesystem recovery or real access policy.
- Finance database integration records internal payment/reconciliation evidence and makes no provider-settlement claim. This wave does not prove correct full order-to-payment balance, live refund rights, legal invoice issuance, external settlement or payment-provider integration.

## Screen matrix and acceptance

The canonical 178 IDs, names and routes remain unchanged. Current classification remains **151 partial, 27 restricted, 0 complete, 0 accepted**. Wave 5 API test evidence is not screen completion, visual parity or manual acceptance. The CSV matrix remains the source of record; any refreshed generated evidence must be reconciled through `scripts/reconcile-screen-inventory.mjs` and validated by its tests.

## Changed source

- `src/app/api/appointments/route.db.integration.test.ts` — dispatch handover concurrency assertion; exact expected outcome is one successful transition and one stale-version conflict.
- This report and the tracker entry record the supported contract and remaining gates.

No application API, business rule, migration, persistent database or production configuration was changed. No real providers, live payments, messages, reports or clinical operations were activated.

## Remaining blockers and next priorities

1. Build a genuine API-sequence test from authorized enquiry/CRM conversion into a **test-only** verified catalogue, confirmed synthetic appointment/order, API-created collection job and field collection, without directly seeding operational states. Keep all approvals visibly test-only and retain production policy gates.
2. Extend isolated tests for report document upload/quarantine/read-denial and correction lifecycle only where test scanner/storage adapters can be safely isolated; do not fabricate an external lab report.
3. Connect order charge snapshots to existing finance internal records, then test balances, partial/disputed states and refunds only against supported schemas and roles.
4. Run operator UI tests against a disposable isolated app/database; otherwise leave visual/accessibility/manual acceptance pending.
5. Qualify migrations against the protected persistent development DB only after separate authorization; the reported DB/source migration gap, backup/restore, encryption-key recovery and credential rotation remain release blockers.

No production readiness or final screen acceptance is claimed.
