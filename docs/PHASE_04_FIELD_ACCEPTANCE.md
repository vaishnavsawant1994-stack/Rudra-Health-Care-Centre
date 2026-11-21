# Phase 04 — Home Collection & Field Staff (F001–F015)

Checkpoint: 13 November 2026. Scope: development-first reconciliation against `docs/SCREEN_SPEC_178.md` and the current source. Synthetic-only records. No database schema migration, production data, deployment, commit, or push was used for this checkpoint.

## Screen-by-screen status

| ID | Canonical screen / route | Current code evidence | Status / acceptance |
|---|---|---|---|
| F001 | Phlebotomist today dashboard — `/field/today` | Signed-in staff view uses assigned/centre-scoped collection operations and schedule date filtering. | Partial; manual responsive/device acceptance pending. |
| F002 | Collection assignment & dispatch — `/ops/collections/dispatch` | Canonical alias enters the protected collection operations desk; creation requires a confirmed appointment and order; assignment checks active role and scheduling conflicts. | Partial; canonical route added; manual acceptance pending. |
| F003 | Collection job detail — `/field/jobs/[id]` | Alias enters the existing authenticated collection detail workflow, backed by the job API. | Partial; action-by-action/manual acceptance pending. |
| F004 | Accept/reject/start collection — `/field/jobs/[id]/start` | Alias anchors to existing accept/decline/start actions; state changes require assignment, centre permissions, expected version and idempotency. | Partial; canonical route added; manual acceptance pending. |
| F005 | Collector route — `/field/route` | Assigned-user and centre-local date/stage filtering exist. No live map, geolocation, route optimization or directions provider was evidenced. | Partial; no provider integration claimed. |
| F006 | Travel / arrival — `/field/jobs/[id]/travel` | Alias anchors to existing travel, arrival, delay and attempt outcome controls, persisted as audited events. ETA is an internal staff estimate. | Partial; no live location tracking or customer notification. |
| F007 | Collection readiness checklist — `/field/jobs/[id]/checklist` | Alias anchors to the collection record. Current form verifies the approved procedure reference and staff identity-check attestation. | Partial; does not implement full clinical preparation, consent, supply, or instruction checklist. |
| F008 | Specimen collection & barcode — `/field/jobs/[id]/collect` | Alias anchors to an authorized collection form. Server requires assigned collector, arrival, active centre collection procedure and identity confirmation; generates unique Rudra specimen ID with custody/audit events. | Partial; generated ID is not scanner/camera barcode capture; barcode standard and clinical labeling policy remain unapproved. |
| F009 | Collection payment — `/field/jobs/[id]/payment` | Alias anchors to billing section. Users with `finance.read` for the job centre can open protected order billing; other users see a permission-gated message. No field payment capture/provider confirmation exists. | Restricted/partial; real payment functionality unavailable. |
| F010 | Complete collection visit — `/field/jobs/[id]/complete` | Alias anchors to visit completion. Server requires recorded specimen(s), valid visit state and permission; order/report completion remains separate. | Partial; not an appointment, diagnostic-order, or report confirmation. |
| F011 | Specimen handover — `/field/handover` | Assigned collector can submit collected specimen to Rudra receiving; branch receiving staff separately confirm physical receipt under an approved procedure. | Partial; manual-first custody workflow; external lab handoff is a separate staff action. |
| F012 | Field issue / exception — `/field/jobs/[id]/issue` | Alias enters the authorized field exception route; existing specimen exception queue supports scoped issue records and controlled recollection. | Partial; canonical job issue URL routes to the field exception queue; exact job-specific prefilling remains limited. |
| F013 | Field support — `/field/support` | Protected internal support workflow exists; no telephony or third-party support provider is connected. | Partial; manual acceptance pending. |
| F014 | Field schedule — `/field/schedule` | Read-only assigned collection schedule, centre-local date handling; no payroll attendance or clock-in behavior. | Partial; attendance integration/policy is absent. |
| F015 | Offline field queue — `/field/offline` | Explicit restricted state explains that collection requires live server authorization and the app does not cache private field data for replay. | Offline queue intentionally unavailable; no encrypted offline queue or sync/replay implemented. |

## Implemented in this checkpoint

- Added canonical F002–F004 and F006–F010/F012 URLs as aliases to existing protected workflows. The destination retains its own session, centre and permission checks.
- Added a restricted F015 offline route. It does not persist sensitive field data in browser storage.
- Added field workflow section navigation, clearer generated specimen-ID labeling, authorized finance link gating, and exception-queue navigation on job detail.
- Updated generic workflow links to the canonical `/field/jobs/[id]` path and the F002 dispatch alias.
- Regenerated the 178-screen CSV from the original screen specification. Canonical screen IDs/names/routes were not changed. Current global source inventory: 91 exact route shapes, 87 without exact route shape, 22 explicit grouped mappings, 83 missing both exact route and explicit mapping; implementation evidence classes are 48 page/API/test candidates, 22 explicit grouped mappings, 83 unresolved, 25 blocked. These categories measure different things and do not equal completion.
- No database migration was required or added.

## Existing server-side controls retained

Collection jobs are created from confirmed appointment/order pairs and are idempotent. Assignment checks authorized active collectors and scheduling conflicts. Field state changes are versioned, idempotent and audited. Specimen collection requires assigned staff (or authorized scheduler), a started and arrived visit, an active approved centre procedure, and identity-check confirmation. Specimen custody is append-only; collector handover submission is not physical receipt. Receiving and external lab events require separate authorized actions. Field queues avoid disclosing patient identity beyond the caller’s permitted grants.

## Outstanding corrections and blockers

1. F007/F008 require an owner-approved clinical checklist, labeling/barcode standard, consent/preparation instructions and clinical procedure references before those items can be represented as completed controls. Current identity confirmation is a staff attestation only.
2. F008 currently issues a unique Rudra specimen identifier but has no barcode scanner/camera capture or approved externally scannable format.
3. F005/F006 lack navigation provider, GPS, optimized directions and location/ETA integration. Do not send home addresses to a map provider without an approved privacy policy and explicit user action.
4. F009 remains unavailable for field payment capture pending billing policy and authorized provider. Finance users can access existing protected order billing only.
5. F012 issue URL is a canonical route to the field exception queue rather than a job-prefilled exception editor. Keep severity, recollection and escalation policy center-authorized.
6. F014 has no attendance/payroll behavior. F015 remains unavailable until encrypted device storage, device access policy, conflict handling, revocation, audit/replay and privacy review are specified and tested.
7. All F001–F015 require the deferred manual browser acceptance campaign. No screen is finally accepted by this report.

## Verification in this checkpoint

- Focused Vitest: 37/37 across inventory reconciliation, sample collection policy and sample API tests passed.
- Inventory generator wrote all 178 rows from the canonical specification.
- TypeScript passed after the final navigation changes.
- ESLint passed.
- Isolated PostgreSQL integration passed: 98 migrations replayed in the synthetic integration environment, including collection/sample, role scope and audit checks.
- Production build passed; all 327 static pages generated and dynamic routes retained.
- Full Vitest: 902/902 tests passed across 221 files.
- Browser/device acceptance remains pending. No result is inferred from earlier Phase 03 verification.

## Wave 4 custody continuation — 15 November 2026

The disposable integration suite now verifies the receiving-to-dispatch custody portion after a collected specimen exists: handover submission, separate branch receipt, packing, batch creation and staff-recorded simulated carrier handover. This is not evidence of actual patient identity proof, physical specimen collection, or clinical SOP approval. See `MASTER_CLOSEOUT_WAVE4_2026-11-15.md` for exact API assertions and limits. The field UI has not had browser or clinical-operator acceptance.

## Next wave

Proceed to Phase 05 only after completing manual acceptance and resolving the clinically approved collection checklist and barcode policy decisions. Keep payment, offline replay, GPS/directions, attendance and external provider functions disabled until their requirements and approvals exist.
## Wave 3 upstream integration boundary — 15 November 2026

The new cross-module integration scenario exercises the collection-job API from a linked appointment/order and verifies that an order backed only by a synthetic, unverified catalogue version remains `PENDING_VERIFICATION`; the API refuses job creation and leaves the collection queue unchanged. Collector assignment, travel/arrival, clinical checklist, collection, specimen handover, physical receiving, branch dispatch and external-lab evidence continue to rely on their existing isolated API/PostgreSQL coverage; they were not chained into this scenario. No clinical step, collection job or lab event was fabricated.

## Collection queue stale-response protection — 22 November 2026

`CollectionOperations`, used by F001 and F002, and `SamplesDirectory`, used by F011 field handover and L003 branch receiving, now use the shared request-sequence guard. Responses for superseded date, stage, page, centre, or route-scope queries cannot replace the currently requested list, and unmounted views invalidate in-flight results. Rows are cleared while a new query loads. This is a UI privacy/reliability safeguard; no job lifecycle, physical receipt, or clinical permission was relaxed.

Verification after this change: request-sequence, collection query, dispatch UI, dispatch queue, collection and sample PostgreSQL integration, and dispatch route tests passed **16/16 across seven files**; ESLint, TypeScript, and the production build passed (406 generated routes). These are automated component-contract/API results, not a new browser acceptance run. F001/F002, F011, and L003 remain partial; browser verification, full accessibility, and visual review remain pending. No persistent database migration or external provider action was performed.
