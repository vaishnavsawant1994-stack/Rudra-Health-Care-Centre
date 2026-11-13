# Rudra Health OS master audit update

Audit date: 12 November 2026
Repository: `F:\Rudra Health Care Centre\rudra-health-os`
Scope: read-only source, Git history, tracked design/source references, supplied S001–S012 screenshots and existing 178-screen matrix. No database access, migrations, tests, or Git mutations performed.

## Result summary

- Git branch `master`, HEAD `1d03e9f1f0ef3e95a26f48a4c75f8e7c2220a97d`; `origin/master` matches. Worktree/index clean.
- `a7779e7` → `c18082a` changes exactly 100 paths; `c18082a` is an ancestor of current HEAD. The earlier staged set was committed in that implementation commit and remains in current history; it is not lost.
- The matrix has 178 distinct rows preserving the source ID/name/route. Evidence group counts are 39 exact-source partials, 21 explicit grouped mappings, 92 mapping-unresolved partials and 26 external/policy blocked. These are mapping/evidence categories and are not the older 111/29/38 implementation labels.
- Final acceptance is pending for all 178: no screen-specific desktop/mobile acceptance is recorded. Listed test paths were not run in this audit.
- Companion CSV retains every original column and adds distinct implementation, route-mapping, visual-reference, QA and final-acceptance overlay columns.

## Priority findings

### P1 — W007–W010 booking

The regression/gap remains in the live route wiring. `/book`, `/book/review`, `/book/payment`, and `/book/confirmation` render `RudraBookingFlow`, which keeps values in `sessionStorage`, performs no submit call, disables payment, and explicitly says no appointment, patient record or payment is created. Expected spec routes `/checkout/[order]` and `/booking/success/[id]` are absent from that flow.

A separate `PublicEnquiryForm` can POST to `/api/public/enquiries` with `requestKind: BOOKING_REQUEST`. The API creates an encrypted, idempotent, rate-limited public enquiry and responds `202`; it does not reserve a slot, create an appointment or collect payment. This is an enquiry request workflow, not booking completion. Maintain synthetic-only data and do not imply payment-provider or appointment integration.

### P2 — S001 auth, MFA and sessions

Current code configures Better Auth email/password with sign-up disabled, eight-hour sessions, TOTP MFA and zero trusted-device lifetime (`trustDeviceMaxAge: 0`). TOTP and backup-code verification request `trustDevice: false`; access checks the enabled factor, verified enrollment and `mfaVerifiedAt` on the current session. A scoped admin endpoint lists and revokes sessions with an audit event. These are source/configuration findings, not independent security acceptance.

`docs/PHASE_01_SETUP.md` contains older OIDC-not-configured statements and later closeout text documenting the selected local Better Auth password+TOTP setup. Treat earlier OIDC paragraphs as stale historical notes for current configuration. The same doc records owner-reported manual acceptance and source/unit-test evidence; this audit did not repeat those tests or browser actions. The supplied S001 mock shows a checked “Remember this device” control, contradicting current no-trust-device policy. `/staff/login` in the matrix also differs from the current `/staff` route.

Encryption is field/domain-specific, not universal. Source includes AES-GCM crypto modules for lead, patient contact, family, finance/report and operational private payloads plus blind indexes. Public enquiry submission stores private fields encrypted. Plaintext schema identifiers/status/timestamps and some structured fields remain visible by design. This read-only source review did not establish a complete entity-by-entity encryption inventory or inspect keys, environment files, database contents or secrets. No encryption/security acceptance is claimed.

### P3 — Visual/design reconciliation

The supplied screenshots show inconsistent logo lockups/marks across S001–S012 (leaf-style top lockup vs flower-style dark-sidebar mark); this is image-visible inconsistency, but cannot be judged against canonical artwork until the approved L001 and C001 reference files are available. No L001/C001 canonical image asset or the claimed ChatGPT reconciliation workbook/report was found in the inspected project and attachment locations. The previous pasted audit text is available, but not its referenced standalone artifacts.

S002 account-state counts total 127 (102+8+6+2+3+6) against headline 128. MFA pending 9 appears to be an overlapping attribute rather than a disjoint account state; the screenshot does not define that relationship, so the one-user difference is a discrepancy requiring an explicit denominator/status definition, not a proven arithmetic error.

S012 screenshot presents an 11-phase 178-screen tracker with sequential `S001–S178`-style ranges and Phase 11 at 18 screens. The canonical spec inventory uses 11 groups W/P/R/F/L/B/C/A/M/O/S with counts 26/16/18/15/17/15/12/13/18/16/12. These are different numbering schemes; the screenshot's phase ranges do not reconcile to the canonical IDs. Preserve canonical IDs and do not relabel them as sequential S IDs.

M008–M016 are title/role mismatches between `SCREEN_SPEC_178.md` and current marketing preview code: M008 is specified Meta content but preview is social inbox; M009 YouTube/video vs reviews/reputation; M010 LinkedIn/corporate vs campaign builder; M011 Google Business/reputation vs audience/budget; M012 campaign planner vs social analytics; M013 paid ads vs leads attribution; M014 landing page/CMS vs SEO/content performance; M015 SEO/search vs automation/follow-up; M016 social interactions vs reports/exports. All nine mismatches are source/spec verified at title level; original screen-by-screen approved screenshot assignments were not available for confirmation.

### Additional correction priorities

1. Restore the canonical W007–W010 flow only after approved appointment/payment requirements and integrations are defined; until then keep the enquiry request clearly separate and preview routes non-transacting.
2. Replace S001 trusted-device mock control with policy-consistent wording/state; align `/staff/login` vs `/staff` route references and reconcile stale setup documentation.
3. Resolve S002 account-state denominator and S012 phase-range/ID mapping in source design specifications.
4. Remap M008–M016 to canonical screen definitions or revise the spec through approved product decisions; keep social platform connections and publishing marked synthetic/unconfigured.
5. Obtain approved L001/C001 source images, canonical logo assets and the claimed external reconciliation artifacts before claiming pixel-level comparison or audit-source reconciliation.
6. Complete field-by-field encryption/data minimization mapping and security acceptance evidence without reading production records or exposing keys.

## Evidence labels and limitations

- **Code verified:** current route composition, preview-only booking behavior, enquiry POST semantics, auth configuration, MFA trust policy, access checks and session revocation routes; M008–M016 title drift.
- **Image verified:** supplied S001–S012 screenshots, including S001 trusted-device checkbox, logo variation, S002 count display and S012 tracker labeling/ranges.
- **Documented:** inventory and candidate source/API/schema/permission/test paths in `docs/SCREEN_IMPLEMENTATION_MATRIX.csv`; product definitions in `docs/SCREEN_SPEC_178.md`; historical setup qualification notes in `docs/PHASE_01_SETUP.md`.
- **Not verified:** L001/C001 pixel match; the separate ChatGPT workbook/reconciliation report; all 178 visual comparisons; full API/interaction behavior beyond inspected flows; current test pass state; security acceptance; production payment, Metropolis, social or other third-party connectivity; live DB contents. No secrets or real patient data were read.

## Acceptance criteria for closing the 178 rows

For each preserved screen ID: canonical image/source approved; desktop and mobile screenshots captured at specified viewports; route resolves to the intended screen; primary links/actions execute the specified workflow; API permissions and centre scope verified with synthetic fixtures; loading/empty/error/success states checked; privacy and synthetic-data controls pass; integration claims reflect configured/tested state; automated checks are run and recorded; screen-level reviewer acceptance is signed off. No aggregate module test substitutes for per-screen acceptance.


## Development milestone update: W007-W010

Date: 12 November 2026. This is a controlled local development implementation. No push, commit, deployment, production data change, payment-provider integration or new migration was performed.

### Implemented behavior

- **W007 `/book`:** the booking journey loads public centres and the selected centre published diagnostic catalogue from existing APIs, with search and pagination. It supports multiple selected tests/packages and keeps contact details, preferred visit/date/time and address in an in-memory draft provider shared by the `/book` route layout. Customer contact details, selected services, addresses, request bodies and body hashes remain in application memory only and are not placed in the URL; session storage holds only the opaque random idempotency UUID needed to replay an uncertain submission.
- **W008 `/book/review`:** the review state displays the selected service names, authoritative catalogue versions/prices, customer-entered request details and the requested visit. Submitting calls `POST /api/public/enquiries` once from the UI, using an idempotency key; API replay behavior is protected by the existing organization/key uniqueness, request fingerprint and transaction lock. A successful response navigates to the receipt route.
- **Enquiry API:** validates payload fields, same-origin requests, idempotency key, centre eligibility, every requested item ID and exact current published version. It stores service snapshots, contact data, request details and optional supported home-fee request in the existing encrypted private payload. Home fees are request preferences (supported values INR 75/99/150), not accepted charges; staff must verify the final amount. Multiple selected service details are exposed only in authorized centre-scoped staff review and carried into lead activity on conversion. No schema change was needed.
- **W009 `/book/payment`:** remains explicitly unavailable. There is no checkout workflow, payment provider, payment attempt or simulated payment; payment controls remain disabled.
- **W010 `/book/confirmation`:** only shows an enquiry reference after the API returns accepted. Copy identifies this as an enquiry receipt, not an appointment confirmation. Reloading loses the in-memory receipt and directs users to submit a request before showing a receipt.
- The reception/CRM public-enquiry review endpoint already lists only the authorized centre's queue; new booking request details appear with catalogue snapshots and the requested fee visibly marked as requiring staff verification. Contact permission remains independently reviewed; submissions do not automatically authorize outreach.

### Matrix and verification

The regenerated source matrix retains all 178 original IDs, names and proposed routes. Current mutually-exclusive source-evidence counts are 39 direct-source partials, 22 explicit grouped mappings, 92 mapping-unresolved partials and 25 blocked. W010 moved from blocked to explicitly mapped as an enquiry receipt; W009 remains blocked/unavailable. These classifications are not acceptance counts. W007-W010 remain pending screen-specific manual visual and product acceptance.

Verification completed:

- `npm.cmd run lint` ? passed.
- `npm.cmd run typecheck` ? passed.
- `npm.cmd test` ? 204 test files passed; 846 tests passed.
- `npm.cmd exec vitest run -- src/app/api/public/enquiries/route.db.integration.test.ts` ? 14 tests passed using a dedicated synthetic test schema. Final focused set (idempotency key, policy, route unit, route integration and inventory reconciliation): 5 files / 44 tests passed.
- `npm.cmd run build` ? production build passed; all 284 static pages generated.

Tests include accepted public enquiry creation and encrypted storage, idempotent replay, catalogue centre/version revalidation, malformed/missing request fields, home-collection address/fee rules, queue privacy projection, centre-scope authorization and lead conversion. No browser-driven visual/interaction acceptance was run. Automated test success does not mean W007-W010 are product-accepted.

### Changed project files

`src/app/book/layout.tsx`; `src/components/public/rudra-booking-flow.tsx`; `src/app/globals.css`; `src/server/public-enquiry-policy.ts`; `src/app/api/public/enquiries/route.ts`; `src/components/leads/public-enquiry-workbench.tsx`; `src/server/public-enquiry-policy.test.ts`; `src/app/api/public/enquiries/route.test.ts`; `src/app/api/public/enquiries/route.db.integration.test.ts`; `scripts/reconcile-screen-inventory.mjs`; `scripts/reconcile-screen-inventory.test.mjs`; `docs/SCREEN_IMPLEMENTATION_MATRIX.csv`; `docs/SCREEN_IMPLEMENTATION_MATRIX.md`.

### Remaining blockers

- Genuine appointment creation, slot reservation, cancellation/rescheduling and patient identity linking need an approved backend workflow before W007/W008 can represent confirmed bookings.
- W009 checkout remains blocked pending an authorized payment provider, legal invoice decision, verified payment callback and reconciliation workflow.
- The W010 spec route `/booking/success/[id]` is not implemented; current `/book/confirmation` is only an enquiry receipt and its reference does not survive reload.
- Standard requested home fee is recorded as a preference; centre policy/configuration and staff verification must determine the final charge.
- Complete desktop/mobile visual review and screen-specific product acceptance remain pending.
- The integration test used a dedicated disposable synthetic test schema only. No production database data or credentials were inspected or modified. No migration was added.

## Development milestone update: Phase 01 public website & discovery (W001–W026)

Update date: 13 November 2026. Local development only. No commit, push, deployment, migration, production database access or real patient/staff data use. Synthetic fixtures only. This section supersedes earlier W007–W010 notes where they conflict with the current source: personal contact/address fields are kept in in-memory form state, not sessionStorage; sessionStorage retains only the opaque idempotency key. The repository implementation matrix remains the row-level evidence source, and the companion CSV overlays have been updated for all 26 W screens.

### Implemented in this development wave

- Replaced homepage demo catalogue/location content with published catalogue and centre data. Removed hard-coded sample packages, unsupported centre claims, illustrative history and unapproved Metropolis/accreditation statements from public pages/components.
- `/tests`, `/packages`, and their details now use only the published catalogue APIs. Removed hard-coded illustrative CBC/package records and added loading, error/retry and published-data states. Directory provides supported search, centre selection, pagination and package comparisons; filters requiring unpublished demographic metadata remain unavailable.
- Public booking supports multiple selected, versioned tests/packages, home-collection preference and optional customer-reported fee choice. These are submitted to the existing `POST /api/public/enquiries`, where server validation and idempotency apply. Customer contact/address data remain in memory for the workflow; session storage does not contain personal fields. Staff reception review remains centre-scoped and receives selected catalogue snapshots, requested fee and visit preferences. The existing CRM conversion path carries these details into lead metadata, subject to staff permissions. The UI and data still describe an enquiry request; they do not create or confirm an appointment, reserve a collection slot, or accept payment.
- W009 has an explicit unavailable state and does not initiate a payment. W010 acknowledges only the accepted enquiry; receipt state is transient and is not an appointment confirmation.
- Added canonical safe routes for `/track`, `/health-guides`, allow-listed health guide details, `/checkout/[order]`, and allow-listed legal summaries. `/track` directs to the privacy-safe explanation; no order/report lookup was added. Health/legal copy remains unreviewed or draft as applicable. `/partner` redirect behavior is preserved.
- Corrected FAQ wording so a request is not described as an appointment/slot/fee/payment confirmation. Updated public navigation/footer labels to reflect restricted patient access and draft policy pages.
- Added regression tests for published-catalogue sourcing, removal of demo fallbacks, checkout unavailability, safe tracking redirect, guide/legal allow-lists, and enquiry persistence/CRM handoff including multiple selected services and a customer-reported zero-fee choice. The staff workflow continues to enforce centre/role authorization; conversion is audit-recorded and tested through synthetic PostgreSQL integration coverage.
- Added Next.js static-generation parameters for finite guide/legal pages and blocking rendering for request-time test/package/centre details so the production build can complete without inventing catalogue content.

### W001–W026 status summary

| IDs | Current status |
|---|---|
| W001–W006 | Development improvements implemented for published-data homepage, catalogue directories and item details. Automated source/page tests pass. Screen-level design/functional acceptance is pending. |
| W007–W008 | Enquiry submission, review, privacy, idempotency and centre-scoped CRM handoff are implemented on existing APIs and persistence. Synthetic database integration coverage passes. This is an enquiry workflow, not a confirmed appointment. Manual acceptance is pending. |
| W009 | Unavailable/blocked pending authorized payment provider and billing policy. |
| W010 | Enquiry acknowledgement only. No appointment, payment or slot confirmation. Reload recovery remains unavailable. |
| W011–W013 | Public home collection, centre directory and centre detail continue to use reviewed/published information. Availability/fees require staff confirmation; no slot reservation. Manual acceptance pending. |
| W014–W017 | Tracking/report lookup and patient account access remain restricted. `/track` is an explanatory redirect. Patient identity proofing/authentication decisions remain blockers. |
| W018–W022 | Corporate, doctor/referral, partner, contact and FAQ public paths remain enquiry/information workflows. No contract, referral, third-party integration or appointment is inferred. `/partner` redirects to `/partners`. |
| W023–W024 | Canonical education routes exist for limited content; clinical review remains pending. Unknown guide slugs return not found. |
| W025 | Promotions remain blocked by catalogue/pricing and promotion approval. A catalogue listing is not an approved offer. |
| W026 | Legal summary routes exist as draft/non-binding content; legal issuer approval is pending. No approved cookie-consent or final legal policy is claimed. |

Every final acceptance field remains pending. No manual desktop/mobile browser acceptance campaign was run. Approved screen-level reference images were not available as an executable comparison set, so no pixel-match claim is made. Automated aggregate checks do not establish accessibility, responsive or per-screen acceptance.

### Verification

- `npm.cmd test`: **213 test files passed; 853 tests passed**.
- `npm.cmd run lint`: passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed; Next.js generated **296 static pages** and listed request-rendered routes. The successful build includes the finite guide/legal allow-lists and request-time catalogue/centre detail routes.
- `git diff --check`: passed earlier in this wave; line-ending normalization warnings were informational.
- No migrations were needed. Existing encrypted public-enquiry persistence, idempotency, staff permissions and audit events were reused. The test suite uses synthetic/isolated test data; it does not validate production integrations or production state.

### Remaining blockers and next development wave

1. Run the deferred manual acceptance campaign across 26 public screens at approved desktop/mobile viewports, with keyboard/screen-reader checks and recorded screenshots; do not mark screens accepted before this evidence exists.
2. Obtain approved L001/C001 reference assets and map approved designs to individual public screens before making pixel-match claims.
3. Complete owner/legal approval for policy issuer and final privacy/terms/cookie controls; clinical review of educational content; diagnostic catalogue/price/promotions approvals.
4. Keep patient login, report access, online payment and order tracking unavailable until identity, authorization, billing-provider and report-release requirements have approved workflows and tests.
5. Continue Phase 01 with per-screen workflow checks and support/contact error, loading, empty, retry, responsive and accessibility coverage; only then advance to the next development wave.

No security, integration, visual or product acceptance is claimed beyond the exact source/test/build evidence above.

## 13 November 2026 checkpoint — Phase 01 W001–W026 hardening

This checkpoint continues the existing Phase 01 implementation; canonical screen IDs, names and routes are unchanged. The screen-by-screen status and precise limitations are in `docs/PHASE_01_PUBLIC_ACCEPTANCE.md`. The generated 178-screen inventory remains a separate route/implementation evidence source and is not treated as a completion counter.

### Additional implementation in this checkpoint

- W011–W013: published centre addresses now support user-initiated map directions; centre/service loading, retry and stale-result handling were hardened. Published free-text area guidance remains informational and cannot establish postcode coverage, serviceability, capacity, fees or a booking slot.
- W018–W022: replaced mock CRM “not connected” UI with actual staff-review steps; synthetic integration coverage now exercises doctor and partner enquiry handling, authorized conversion, inactive pending partner state, centre scope, pending customer-contact permission and immutable event history. Staff follow-up assignment uses the existing `tasks.assign` permission and centre-scoped assignee API.
- W023–W024: marked educational copy pending clinical review and noindex until approved.
- W025: added the published package catalogue to sitemap and verifies that no unapproved promotion is implied.
- W026: added explicit local cookie-category preferences. Necessary storage remains required; optional provider integrations are not activated or represented as connected. Legal policy issuer approval is still pending.
- W007–W010: corrected request/enquiry language in page metadata and review headings. Payment remains unavailable; W010 remains an enquiry acknowledgement, never an appointment/payment/slot confirmation.
- Added checks for home collection, centre directory/retry, restricted tracking/report/login/register states, offers, cookie preferences, staff task scope and synthetic CRM events.

### Current Phase 01 status

| IDs | Status at 13 Nov 2026 |
|---|---|
| W001–W008, W010–W013, W018–W022 | Partial implementation evidence; screen-by-screen browser acceptance pending. |
| W009, W014–W017, W023–W026 | Restricted/unavailable pending provider, identity, clinical, pricing or legal approval as specified in the Phase 01 register. |
| All 26 screens | Manual desktop/mobile, keyboard/accessibility and approved-reference visual acceptance pending. |

No screen is marked fully implemented and accepted. Public home-collection area data is staff-published informational text, not a geospatial service. Metropolis remains manual-first. No real patient/staff information, production state, migrations or provider integrations were used or changed.

### Verification

- Full Vitest: **867 tests passed across 219 files**.
- ESLint: passed.
- TypeScript: passed.
- Next.js production build: passed; **296 static pages** generated.
- `npm.cmd run db:integration`: passed against the guarded development test database; **98 migrations replayed** and synthetic credential/MFA, patient/family/lead/appointment, catalogue/order, collection/sample, financial, reports, encrypted website-content, append-only history, RBAC and audit checks passed.
- No production deployment was performed. Automated checks do not establish browser, visual, clinical, legal, provider or production acceptance.

### Phase 02 preparation

Patient/family portal entry gates and an implementation sequence are documented in `docs/PHASE_02_PORTAL_READINESS.md`. Patient registration, patient authentication and patient report access remain disabled pending the named identity, consent, report-release and security approvals.
