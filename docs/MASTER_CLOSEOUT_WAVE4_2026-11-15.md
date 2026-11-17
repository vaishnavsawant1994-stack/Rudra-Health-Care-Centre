# Master Closeout Wave 4 — Field custody and branch dispatch evidence

**Date:** 15 November 2026  
**Repository:** `master` at `872eeebfd05adc30edb90490bbe4d3b2369add91` (existing worktree preserved)  
**Data:** synthetic only; PostgreSQL test schema is created and dropped by the integration suite.  
**Scope:** verification extension for specimen receipt, packing, dispatch preparation and recorded handover.

## What was verified

The PostgreSQL appointment/collection integration suite now drives an existing synthetic specimen through receiving submission, branch receipt, packing, dispatch batch creation and the handover API. The new fixture procedure references are explicitly marked `TEST ONLY` and live only in the suite's disposable schema. They are not clinical SOPs, transport approvals, real carrier records or external laboratory evidence.

The suite asserts one each of the expected append-only custody events (`SUBMITTED_FOR_RECEIVING`, `RECEIVED_AT_RUDRA`, `PACKED`, `DISPATCHED`), staff-recorded provenance, a `DISPATCHED` batch/specimen final state, no external receipt row, duplicate batch prevention for the same specimen, and stale-version rejection on repeated handover. Existing coverage in that suite also tests assigned collector privacy scope, cross-centre denial, handover submission replay and branch receive replay.

Focused result: `src/app/api/appointments/route.db.integration.test.ts` passed **33/33**. Full Vitest passed **956/956 across 240 files**. The 19 inventory reconciliation tests passed. ESLint, TypeScript and production build passed; build generated **406 route entries**. The 178-row route inventory reconciled successfully. `git diff --check` passed with repository LF/CRLF normalization notices only.

## Current chain boundary

| Stage | Evidence | Boundary |
|---|---|---|
| Public enquiry → staff CRM → patient → requested appointment | Wave 3 disposable PostgreSQL integration | Catalogue price is not verified; no real order/appointment confirmation is claimed. |
| Confirmed appointment/order → collection job | Existing API validates centre/patient/order linkage and requires confirmed order/eligible appointment | Not independently advanced in the Wave 4 test because the required catalogue and appointment approvals are not available as real policy. |
| Assignment, acceptance, travel, arrival and collection | Protected APIs and existing focused policy/API tests | This new Wave 4 assertion starts from an existing test-only collected specimen rather than establishing clinical collection from physical identity proof. |
| Handover submission → Rudra receipt → pack → dispatch → carrier handover | Added database-backed synthetic API coverage | `DISPATCHED` is internal staff-recorded handover only. It does not prove carrier acceptance, destination receipt, Metropolis processing or chain-of-custody completeness in the real world. |
| External lab evidence → report → finance | Separate protected/manual-first workflows | No external receipt, lab status, report, result release, invoice or settlement was created or verified here. |

## Source and test references

- `src/app/api/appointments/route.db.integration.test.ts` — disposable PostgreSQL coverage of queue scope, submission/receipt, dispatch creation, replay/conflict behavior and custody events.
- `src/app/api/samples/route.ts` — protected collection, handover submission and receiving state transitions.
- `src/app/api/samples/dispatch/route.ts` and `src/app/api/samples/dispatch/[id]/route.ts` — batch eligibility, packing procedure guard, transport procedure guard and recorded handover.
- `src/components/samples/sample-workbench.tsx` — existing staff UI for receiving, dispatch batch creation and batch handover actions.
- `src/components/samples/dispatch-batch-queue.tsx` — centre-scoped handover/transit queue presentation.

## Status and unresolved blockers

The canonical inventory remains **178 screens: 151 partial, 27 restricted, 0 fully implemented/accepted**. This test adds integration evidence, not screen acceptance. No desktop/mobile/browser, visual parity, accessibility, manual operations, physical sample verification or owner/QA acceptance is inferred.

Still blocked or unverified: valid production catalogue pricing and catalogue-version approval; actual appointment/capacity confirmation; clinical identity and collection SOP approval; barcode standard/hardware; physical sample condition and custody evidence; authorized packing/transport procedures; real carrier contract/acceptance; Metropolis authorization and documentary receipt review; report release and patient access; legal issuer and financial reconciliation policies; local persistent development DB migrations (still 0093 versus source 0100); database/document/key recovery qualification and credential rotation. No persistent database was modified, no secrets were emitted, and no provider, production data, deployment, commit or push was used.

## Next closeout work

1. Add idempotency/replay semantics for dispatch batch creation and dispatch handover, with migration and concurrency tests in an isolated schema before any persistent migration is considered.
2. Add an integrated test that creates a test-only confirmed appointment and order fixture, creates the collection job through its API, then covers assignment → acceptance → travel → arrival → collect → submit → branch receive → pack → dispatch. Clearly preserve all synthetic-policy boundaries.
3. Extend role/centre negative tests to dispatch creation and handover, then add browser interaction tests against an isolated application/database fixture.
4. Keep manual external evidence, report release and finance reconciliation blocked until their real approvals and contracts exist.
5. Continue per-screen verification and manual visual/accessibility acceptance; do not change the 0 accepted count before evidence is recorded.
