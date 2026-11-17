# Rudra Health OS — 178-screen implementation matrix

This is the reconciliation index for the proposed inventory in `SCREEN_SPEC_178.md`.
The generated row-level evidence is in `SCREEN_IMPLEMENTATION_MATRIX.csv`.

Regenerate the inventory after route/source changes with:

```powershell
node scripts/reconcile-screen-inventory.mjs
```

## Current source reconciliation

- Parsed **178/178** screen IDs from the proposal.
- **177** IDs have a page file whose route matches the proposed route shape (dynamic parameters are matched against canonical paths), including the W010 receipt route and Phase 11 routes. This is route evidence only; it does not establish functional completion. The staff-protected `/reports` page is not treated as the public W015 route.
- **1** ID has no exact route-shape match: W015 is explicitly mapped to the privacy-safe `/report-access` explanation. The other 23 explicit grouped mappings are covered by exact canonical routes; **0** IDs lack both a route match and an explicit mapping. These route/mapping counts and implementation classifications are different evidence measures. Candidate module APIs/tests are not screen-specific proof.
- Current evidence-based classifications are **128 partially implemented with page/API/test candidates**, **23 partially implemented with explicit source-validated mappings**, **0 partially implemented with source/action mapping unresolved**, and **27 blocked by an identity-proofing, policy or external dependency**. These total 178 and are the generator's mutually exclusive labels, not a measure of completed functionality.
- No screen is marked fully implemented or “implementation complete, acceptance pending” by this generator. File presence, route manifests, tests in the same module and candidate API matches are not enough evidence to make that claim.

## Reading the CSV

Each row preserves the proposed ID, title, URL, access group, controls and authoritative objects from `SCREEN_SPEC_178.md`. It then records the exact source route if found, possible grouped routes, page imports, candidate API routes, schema symbols imported by those APIs, permission checks and related test files. The final columns separately record visual reference, frontend, backend/API, database, RBAC/privacy, integration, automated-test, manual, accessibility, final Owner/QA and deployment evidence. These columns are conservative evidence labels; they do not promote a screen to complete or accepted.

The source/API/test associations are deliberately labeled as candidates. They are produced from route/module structure and imports; they do not prove that a candidate endpoint serves a particular screen, that every control works, or that its test covers all listed requirements. The acceptance column remains pending because the consolidated manual desktop/mobile campaign has not been completed.

The implementation classifications are evidence-conservative:

1. **Fully implemented for local development:** none promoted automatically. Requires verified functional requirements and relevant automated evidence.
2. **Partially implemented:** page source exists or related module sources suggest a grouped implementation, but individual behavior is not fully reconciled.
3. **Not started:** the generator does not currently assign this label when a proposed route lacks a file, because a consolidated implementation may exist. Those rows remain “mapping unresolved” until inspected; this avoids treating missing route files as proof of absent functionality.
4. **Blocked:** identity proofing or a real external/business/clinical/legal decision blocks the proposed capability.
5. **Implementation complete, acceptance pending:** none promoted automatically; requires evidence that functionality is complete before acceptance is the only remaining gate.

The user-approved identity-proofing decision is to keep patient portal accounts disabled until a method/provider is approved. This matrix does not enable patient registration, sign-in or medical-data access. W003/W005 now use only the verified public catalogue; W004/W006 no longer fall back to illustrative test/package records. W014's canonical `/track` route redirects to the privacy-safe tracking explanation. W023/W024 and W026 have canonical route files, but their educational and legal content remains unapproved and those screens are still blocked/pending acceptance. W009's canonical checkout path displays an unavailable state without starting payment. These route/source updates do not change the acceptance column.

## Next reconciliation work

Verify the 24 explicit mappings and all 178 screens' rendered controls, API mutations, database records, permissions and automated test scope. W010 now has its canonical acknowledgement route; W015 is mapped to the privacy-safe `/report-access` explanation because `/reports` remains staff-only. These mappings do not enable patient report access. Update classifications only with screen-level evidence. Reconcile approved scope changes without deleting original IDs. The 27 blocked rows still require their named identity, policy or external dependency before those capabilities can be enabled.

## Phase 01 checkpoint

The detailed W001–W026 status, per-screen route and evidence, approval gates, automated verification results, and manual acceptance status are recorded in [`PHASE_01_PUBLIC_ACCEPTANCE.md`](PHASE_01_PUBLIC_ACCEPTANCE.md). At the 13 November 2026 checkpoint, 17 screens have partial implementation evidence, 9 remain restricted by approval dependencies, and 0 are fully accepted screen-by-screen. This does not alter the generator's global mapping categories above. Phase 02 prerequisites are documented in [`PHASE_02_PORTAL_READINESS.md`](PHASE_02_PORTAL_READINESS.md).

## Phase 02 checkpoint

P001–P016 now have exact canonical preview routes and a screen-by-screen evidence record in [`PHASE_02_PATIENT_ACCEPTANCE.md`](PHASE_02_PATIENT_ACCEPTANCE.md). All 16 remain no-index and data-free until patient identity, ownership, consent and security gates are approved. The optional synthetic examples make no API calls and write no data. This is preview UI evidence, not live portal functionality or patient acceptance.

## Phase 03 checkpoint

R001–R018 canonical route wiring and current evidence/status are documented in [`PHASE_03_RECEPTION_ACCEPTANCE.md`](PHASE_03_RECEPTION_ACCEPTANCE.md). Canonical route aliases now exist for the approved inventory paths; aliases do not bypass the target page's staff authentication or permissions. Phase 03 remains partial: patient merge/identity correction, capacity reservation, QR identity proofing, connected communications providers, external quote delivery and automatic work transfer are not implemented. All 18 screens remain pending manual acceptance.

## Phase 04 checkpoint

F001-F015 canonical route and implementation evidence are detailed in [PHASE_04_FIELD_ACCEPTANCE.md](PHASE_04_FIELD_ACCEPTANCE.md). All remain partial and pending manual field/device acceptance. F015 offline storage/replay, scanner barcode capture, approved clinical checklist, map/GPS services, field payment capture and attendance are not implemented or enabled. Route aliases reuse permission-protected workflows and do not mark functionality complete.

## Phase 05 checkpoint

L001–L017 now have canonical route files or an explicit source-validated journey mapping. New manual-first Metropolis reference/status records are encrypted, centre/order scoped, idempotent and append-only with independent evidence review; these are staff-recorded entries, not provider confirmation. Metropolis imports and critical-result clinical actions remain disabled pending approved contracts/policies. Report document reads are denied for held, quarantined, exceptional and superseded records. See [PHASE_05_BRANCH_ACCEPTANCE.md](PHASE_05_BRANCH_ACCEPTANCE.md). Focused tests passed 30/30 and full Vitest passed 916/916 across 225 files; ESLint and TypeScript passed. Isolated PostgreSQL integration replayed 99 migrations and passed synthetic checks. The combined integration command's runtime-role stage found the persistent local database `rudra_health_dev` at migration 0093; it was not modified. Production build passed with 346 generated static pages after the L016 Suspense fix. Manual/visual acceptance remains pending. All 17 screens remain partial or restricted; none finally accepted.

## Phase 07 checkpoint

C001-C012 have protected route wiring and partial reuse of the existing doctor and corporate/partner workbenches. The canonical screen-by-screen evidence and blocked capabilities are in [PHASE_07_RELATIONSHIPS_ACCEPTANCE.md](PHASE_07_RELATIONSHIPS_ACCEPTANCE.md). C010 remains explicitly mapped to protected `/relationships/partners` because public `/partners` is W020. `/partner` remains its public redirect; `/partner/portal` is an unavailable, data-free gate. Doctor status and corporate/partner relationship status are not proof of credentials, contracts, pricing approval, or partner onboarding. The new pipeline is aggregate-only and permission-scoped. Focused route suite passed 28/28 across 8 files, including isolated PostgreSQL aggregate scope checks, public redirect, and inventory reconciliation. ESLint and TypeScript passed. The complete suite and production build results are recorded in the Phase 07 acceptance report after completion. All 12 screens remain partial/restricted and unaccepted pending screen-specific, visual, and manual acceptance.

## Phase 08 checkpoint

A001-A013 now have canonical route files. Existing backed workflows are reused for the deterministic public service guide, internal enquiry/draft inbox, encrypted support task queue/detail, internal campaign attribution, permission-checked lead contact attempts, CRM follow-ups, and versioned internal templates. New centre-scoped APIs persist encrypted, versioned draft-only provider policy and knowledge records with append-only audit history; they do not store provider secrets, activate delivery, approve or publish knowledge. Conversation ingestion, AI review, and all external delivery remain unavailable. See [PHASE_08_COMMUNICATIONS_ACCEPTANCE.md](PHASE_08_COMMUNICATIONS_ACCEPTANCE.md) for screen-by-screen frontend, API/database, provider, test and acceptance evidence. Route presence does not equal functional acceptance; all 13 screens remain pending manual visual and functional review.

## Phase 09 checkpoint

All 18 canonical M001–M018 routes now have source-route evidence. The documented crosswalk [`MARKETING_SCREEN_CROSSWALK_M001_M018.md`](MARKETING_SCREEN_CROSSWALK_M001_M018.md) preserves `SCREEN_SPEC_178.md` IDs/names/routes and records the design-preview identity drift for M008–M016. M001 dashboard data uses authorized campaign/content APIs; M003/M005/M006/M007 reuse the encrypted content lifecycle; M012/M017 reuse campaign records and aggregates. Provider accounts, media assets, external social/search data, paid spend, community ingestion and publishing remain unavailable. See [`PHASE_09_MARKETING_ACCEPTANCE.md`](PHASE_09_MARKETING_ACCEPTANCE.md). All 18 screens remain partial/restricted; 0/18 accepted.

## Phase 10 checkpoint

O001–O016 have canonical routes. The exact screen-by-screen evidence, backend reuse, scope gates, unavailable capabilities and remaining acceptance work are recorded in [PHASE_10_OPERATIONS_ACCEPTANCE.md](PHASE_10_OPERATIONS_ACCEPTANCE.md). Existing owner, centre, roster, task, audit, support, CRM and finance workflows are reused under existing authorization. Capacity/SLA/incident/CAPA/SOP/training/inventory/procurement functions remain restricted because authoritative source contracts are absent. Analytics show only supported authorized records; no GPS, external advertising spend, synthetic revenue or CSAT is invented. Full Vitest passed 943/943 across 235 files, TypeScript, ESLint and the production build passed (393 generated static pages). All 16 screens remain pending manual desktop/mobile acceptance; 0/16 are finally accepted.

## Phase 11 checkpoint

S001–S012 have canonical protected route entry points. The screen-by-screen implementation evidence and unavailable actions are recorded in [PHASE_11_PLATFORM_ACCEPTANCE.md](PHASE_11_PLATFORM_ACCEPTANCE.md). Existing staff, role, centre, session, catalogue, manual-first Metropolis and draft-only communications contracts are reused with server-side authorization where available. Privacy operations, feature-flag changes, legal issuer approval, backup/export/restore execution and release approval remain restricted. Full Vitest passed 951/951 across 239 files; focused Phase 11 authorization/reconciliation tests passed 23/23 across five files; ESLint, TypeScript, inventory reconciliation and production build passed (405 static pages). No database migration/integration was run. All 12 screens remain pending manual desktop/mobile and final Owner/QA acceptance; 0/12 finally accepted.


## Master Closeout Wave 8 evidence - 16 November 2026

The 178-row CSV has Wave 8 evidence appended to S001, B001/B002/B005/B006/B008/B009/B011/B015 and L014/L015/L016. The joined PostgreSQL route-handler scenario covers the same synthetic order through separate charge snapshots, internal partial/disputed payment evidence, balance and cash reconciliation, as well as encrypted quarantined report storage. A separate disposable-schema test exercises real Better Auth sessions and TOTP with centre/role checks, CSRF, sign-out and expiry. These are automated implementation evidence only: all screen statuses and acceptance fields remain unchanged, no screen is finally accepted, and live HTTP/browser, legal invoice, payment settlement, real ClamAV, external lab evidence and clinical report release remain pending. See [MASTER_CLOSEOUT_WAVE8_2026-11-16.md](MASTER_CLOSEOUT_WAVE8_2026-11-16.md).

## Master Closeout Wave 9 evidence - 16 November 2026

The inventory generator now separates machine-derived route/source evidence from manually maintained findings and acceptance fields. It preserves all 178 canonical IDs, requires explicit review references for acceptance changes, records source hashes, and is byte-stable across repeated generation. The 178-row CSV adds bounded Wave 9 recovery evidence to L014, L016 and S010; the external overlay also records the S001 session-test rerun. A disposable synthetic PostgreSQL schema and encrypted quarantined document were restored, test-only key recovery/decryption was verified, and the report API continued to deny quarantined access. Full Vitest passed 969/969 before the final two focused recovery assertions; the updated joined recovery test passed 1/1, inventory tests 23/23, recovery safeguards 5/5, Better Auth session integration 1/1, ESLint, TypeScript and production build passed. Totals remain 151 partial, 27 restricted, 0 complete and 0 finally accepted. No live HTTP/browser, real scanner, persistent database upgrade/restore or production DR acceptance occurred. See [MASTER_CLOSEOUT_WAVE9_2026-11-16.md](MASTER_CLOSEOUT_WAVE9_2026-11-16.md).

## Master Closeout Wave 10 evidence - 16 November 2026

Wave 10 makes focused UI reliability changes for R007 (canonical appointment calendar) and R010 (order detail). Calendar loading now has accessible retry/error states, clears stale rows on filter changes/failures and ignores obsolete responses. Order detail distinguishes successful persistence from failed refresh, provides retry, and blocks repeat mutations while the current server state is unknown. The additional appointment overview gained retry behavior but is not treated as the canonical R007 screen. Wave 10 evidence is appended to the two corresponding CSV rows and the sibling external overlay. Full Vitest passed 975/975 across 246 files; focused route/component checks 14/14; inventory regression tests 23/23. ESLint, TypeScript and production build results are in [MASTER_CLOSEOUT_WAVE10_2026-11-16.md](MASTER_CLOSEOUT_WAVE10_2026-11-16.md). These remain partial screens: no browser, visual, responsive, keyboard or Owner/QA acceptance is claimed, and classifications remain 151 partial, 27 restricted, 0 complete, 0 accepted.

## Master Closeout Wave 11 evidence - 16 November 2026

Wave 11 adds frontend recovery and stale-response protections for R014/R015-related lead/enquiry workflows and L005/L006 dispatch/handover workflows. The canonical aliases and grouped mapping are retained and documented separately; the website-enquiry queue is not represented as a telephone system. Dispatch keeps the existing server API, centre authorization and `expectedVersion` conflict contract. Full Vitest passed 981/981 across 249 files; focused UI/API tests passed 27/27 across 9 files; ESLint, TypeScript and production build passed (406 generated routes). Inventory regeneration preserved the new row evidence and pending acceptance states. The browser host was unavailable, so no browser, visual, mobile, keyboard or screen-reader acceptance is claimed. All four rows remain partial; master totals remain 151 partial, 27 restricted, 0 complete and 0 finally accepted. See [MASTER_CLOSEOUT_WAVE11_2026-11-16.md](MASTER_CLOSEOUT_WAVE11_2026-11-16.md).
