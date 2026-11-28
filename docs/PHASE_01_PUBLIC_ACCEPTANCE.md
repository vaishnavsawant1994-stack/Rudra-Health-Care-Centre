# Phase 01 — Public Website & Discovery (W001–W026)

Checkpoint: 13 November 2026
Repository: `rudra-health-os`
Data used: synthetic fixtures only

## Outcome

| Measure | Result |
|---|---:|
| Canonical Phase 01 screens | 26 |
| Partially implemented; automated evidence exists for some behaviors | 17 |
| Restricted by policy, identity, clinical or legal approvals | 9 |
| Fully implemented and accepted screen-by-screen | 0 |
| Manual browser, responsive and accessibility acceptance pending | 26 |

“Partially implemented” means that the route or grouped workflow exists and some behavior is covered by source or automated checks. It does not mean every required control, design detail or scenario is complete. Restricted screens have safe unavailable/explanatory behavior; this is not completion of the gated capability. No manual browser acceptance was performed, and no screen is accepted.

## Screen-by-screen register

| ID | Canonical screen | Route | Development status and evidence | Gate / outstanding work | Manual acceptance |
|---|---|---|---|---|---|
| W001 | Homepage | `/` | Partial; published catalogue/centre source and page checks. | Screen-level interactions and approved visual comparison. | Pending |
| W002 | About Rudra & Metropolis relationship | `/about` | Partial; unverified partner/accreditation claims removed. | Owner/legal review and visual acceptance. | Pending |
| W003 | Test catalogue | `/tests` | Partial; published catalogue, search/filter/pagination and loading/error/retry states. | Per-control, keyboard and responsive acceptance. | Pending |
| W004 | Test detail & preparation | `/tests/[slug]` | Partial; published item/version; no demo fallback. | Review each published item’s approved content and states. | Pending |
| W005 | Health package catalogue | `/packages` | Partial; published package catalogue; no fake totals/fallback. | Catalogue approval and screen-level acceptance. | Pending |
| W006 | Package detail & comparison | `/packages/[slug]` | Partial; published package/version; no demo fallback. | Approved package contents and visual/interaction acceptance. | Pending |
| W007 | Public booking stepper | `/book` | Partial; server-validated idempotent enquiry path and in-memory customer fields. | Full journey acceptance; enquiry remains distinct from appointment. | Pending |
| W008 | Booking review & confirmation | `/book/review` | Partial; enquiry handoff, centre-scoped staff review/CRM evidence and synthetic PostgreSQL integration. | Staff UX and end-to-end manual verification. | Pending |
| W009 | Online payment checkout | `/checkout/[order]` | Restricted; static unavailable state, no provider or payment initiation. | Authorized billing policy and payment provider plus security review. | Pending |
| W010 | Booking success & next steps | `/booking/success/[id]` | Partial; canonical noindex receipt route shows only the opaque UUID returned after public enquiry acceptance. It does not query or reveal enquiry details. | Enquiry acknowledgement only; no appointment, slot or payment confirmation. Staff/browser acceptance pending. | Pending |
| W011 | Home sample collection service | `/home-collection` | Partial; published area guidance and centre links; staff confirmation required. | No approved geographic/zone serviceability engine; no reservation. | Pending |
| W012 | Find centres | `/centres` | Partial; synthetic published directory browser path verified for error/retry, search/no-results and directions; responsive check at 1280/768/390px. | Validate approved centre records; full keyboard/accessibility and visual-reference comparison. | Pending |
| W013 | Centre profile & serviceability | `/centres/[id]` | Partial; synthetic profile and published-service path verified for retry, package filter, price, detail navigation and booking prefill; responsive check at 1280/768/390px. | Free-text area is informational only; no serviceability decision or capacity. Full accessibility/visual and Owner/QA review pending. | Pending |
| W014 | Order tracking entry | `/track` | Restricted; privacy-safe explanation/redirect; no order or report lookup. | Identity, order authorization and report-release policy. | Pending |
| W015 | Report access entry | `/reports` | Restricted; explicitly mapped to the noindex `/report-access` explanation; staff `/reports` remains protected. | Identity proofing, patient/representative authority, consent and report-release workflow. No patient report data is exposed. | Pending |
| W016 | Sign up / patient registration | `/register` | Restricted; self-registration disabled. | Approve identity-proofing method/provider and enrollment controls. | Pending |
| W017 | Login / OTP / recover access | `/login` | Restricted; patient authentication/recovery disabled. | Approve patient authentication, MFA/session and recovery policy. | Pending |
| W018 | Corporate diagnostics landing | `/corporate` | Partial; enquiry submits into staff review/relationship workflow; synthetic DB evidence. | No contract or external service implied; authorized legal/commercial review. | Pending |
| W019 | Doctors & referrals landing | `/doctors` | Partial; enquiry path; doctor CRM conversion and audit tested with synthetic data. | No referral qualification or provider integration claimed. | Pending |
| W020 | Partner/franchise enquiry | `/partner` | Partial; intentional redirect to `/partners`; partner enquiry and gated inactive conversion tested synthetically. | No approval/agreement implied; authorized partner review required. | Pending |
| W021 | Contact & help centre | `/contact` | Partial; centre-routed enquiry; staff task assignment uses `tasks.assign` and centre scope. | No external communications provider; verify staff assignment in browser. | Pending |
| W022 | Frequently asked questions | `/faq` | Partial; FAQ search/topic filters, safe request wording, and common-question links now target their matching answer headings; SSR regression test verifies link/target pairs. | Public content review and browser keyboard/responsive checks. | Pending |
| W023 | Health education / blog | `/health-guides` | Restricted; limited educational content marked pending clinical review and noindex. | Clinical sign-off before public discoverability. | Pending |
| W024 | Health article detail | `/health-guides/[slug]` | Restricted; finite allow-list; unknown slug 404; noindex. | Clinical review and approval of each article. | Pending |
| W025 | Promotions & offers | `/offers` | Restricted; displays only published catalogue packages; no unapproved promotion claim. | Approved pricing, promotions and catalogue publication. | Pending |
| W026 | Privacy, terms, disclosures & accessibility | `/legal/[page]` | Restricted; draft summaries; local cookie preference control does not activate tracking providers. | Legal issuer approval, final notices and consent policy/provider decision. | Pending |

## Evidence from this checkpoint

## Catalogue and centre discovery browser evidence — 28 November 2026

- The push run [46126225461](https://github.com/vaishnavsawant1994-stack/Rudra-Health-Care-Centre/actions/runs/46126225461) and PR run [46126229472](https://github.com/vaishnavsawant1994-stack/Rudra-Health-Care-Centre/actions/runs/46126229472) passed on commit `1c2e621a2b164959c0765df321985b26f21f6323`; both Chromium runs passed **16/16**. Lint, TypeScript, full automated tests, production build, inventory, migration rehearsal, dependency audit and full-history secret scan also passed in the push run.
- W003/W004: Chromium searched published synthetic test data using the keyboard, checked the published record/version in the disposable PostgreSQL database, exercised no-results and injected-503/retry behavior, opened test details and carried the selected centre, item and version to the booking form. No booking was submitted.
- W005/W006: Chromium searched the actual `/packages` catalogue, checked a published synthetic package and its centre-specific price, exercised the comparison panel, opened the package detail and included-test list, and followed its request link with the exact package/centre preselected.
- W012/W013: Chromium exercised directory error/retry, centre search and no-results, the published-address directions link, centre profile, service-query error/retry, package filtering, price, pagination state and package-detail navigation.
- The catalogue/detail and centre-detail interactions were checked at 1280px, 768px and 390px with no horizontal overflow. The package directory's direct search/comparison path was checked at desktop width. The test catalogue search was keyboard-submitted with Enter. This is scoped browser evidence, not a complete keyboard or screen-reader audit.
- No application defect was confirmed in these runs; the initial failures were ambiguous test locators/assertions, which were corrected. The pages use synthetic CI catalogue/centre data only. No patient data, booking, payment, capacity promise or external provider action was involved.
- W003–W006 remain partially implemented despite retained earlier functional evidence. W012/W013 now have screen-specific functional paths recorded in `SCREEN_FUNCTIONAL_EVIDENCE.json`. Approved visual references are still unavailable; comprehensive accessibility, full control coverage and Owner/QA approval remain pending. No screen was marked technically complete or accepted.

## Public enquiry form regression evidence — 28 November 2026

- GitHub Actions PR and push runs [46113593027](https://github.com/vaishnavsawant1994-stack/Rudra-Health-Care-Centre/actions/runs/46113593027) and [46113588633](https://github.com/vaishnavsawant1994-stack/Rudra-Health-Care-Centre/actions/runs/46113588633) passed on commit `ff1cf58cbfe3eb9a1b2bea61d9cce3d842ba1242`; the Chromium suite passed **14/14** in each run.
- One browser scenario exercised the enquiry forms on `/corporate` (W018), `/doctors` (W019), `/partners` (W020) and `/contact` (W021), each at 1280px, 768px and 390px. It rejected submission before any POST when both phone and email were absent, announced the validation error and focused the phone field, then submitted phone-only and email-only requests by keyboard.
- Each valid synthetic request returned HTTP 202 and the safe staff-review acknowledgement. Disposable PostgreSQL assertions verified `PENDING_REVIEW`, correct centre, no lead link, encrypted contact data and a single `SUBMITTED` event. No outbound communication or business approval was claimed.
- This is scoped enquiry-form evidence, not acceptance of all controls on those screens. The check found and fixed missing client-side contact-method validation. Existing W007/W008/W010 booking-to-CRM browser evidence was unchanged and not rerun.
- No canonical approved public screen reference images were found in the repository; the available public images are content assets, not approved paired designs. Visual parity stays unverified. Full accessibility assessment, remaining interactions and Owner/QA approval remain pending for the affected screens; no screen was promoted to technically complete.

- Full Vitest suite: **867 tests passed across 219 files**.
- ESLint: passed.
- TypeScript: passed.
- Production build: passed; **296 static pages** generated.
- `npm.cmd run db:integration`: passed against the guarded test database; **98 migrations replayed**, synthetic workflow/RBAC/encryption/audit checks passed. This is development database evidence, not production acceptance.
- Enquiry PostgreSQL integration coverage includes synthetic doctor and partner submissions, authorization-gated relationship conversion, centre scope, pending contact permission, persisted topic/history and immutable audit events.
- No migration was added in this checkpoint. No production data or real patient/staff details were used.
- `docs/SCREEN_IMPLEMENTATION_MATRIX.csv` remains the generated 178-screen source/route evidence inventory. This report adds Phase 01 behavior/acceptance evidence without changing canonical IDs, names or routes or misrepresenting its global mapping categories as completion counts.
- Detailed original audit and overlay columns are in `docs/audit/Rudra_Health_OS_178_Screen_Audit_2026-11-12.csv`; current checkpoint narrative is in the adjacent report.

## Exact scope and limitations

Automated evidence verifies the named source behaviors and synthetic integrations only. It does not prove all 26 screens are pixel-identical to approved images, accessible to all users, usable at every viewport, or accepted by product owners. No browser/manual campaign or reference-image comparison was run. Directions are only constructed from an address explicitly published by centre staff. Home collection area text is not geospatial coverage and does not confirm availability, price, staff, capacity or a slot. Metropolis remains manual-first; no API provider connection is claimed. Payments, patient identity/report release, clinical content, promotions/catalogue policy and legal issuer remain gated as shown above.

## Next development wave

Prepare Phase 02 portal foundations only after the prerequisites in [`PHASE_02_PORTAL_READINESS.md`](PHASE_02_PORTAL_READINESS.md) are approved. Continue Phase 01 browser acceptance and close any issues found before promoting a screen to accepted.

## Wave 2 route mapping update — 15 November 2026

- Public enquiry POST responses now include the enquiry's random UUID as `receiptId`, alongside the human-readable reference. The canonical `/booking/success/[id]` page accepts only a UUID-shaped value, performs no public database lookup, shows no enquiry/contact/patient details, is noindex and no-referrer, and explicitly states that no appointment, slot or payment is confirmed.
- W015 now has a source-validated grouped mapping to `/report-access`, the existing noindex explanation. `/reports` remains a staff-protected report workspace and is not exposed to anonymous users.
- Inventory before/after: exact route-source matches **176→177**; unmatched route shapes **2→1**; explicit grouped mappings **24→24**; unresolved route mappings **1→0**. Implementation classifications remain **151 partial / 27 restricted**, with **0 accepted**. These route corrections do not promote screens to complete.
- Focused W010/W015/API/matrix tests: **36/36 across three files**. The complete default Vitest suite passed **954/954 across 240 files**; ESLint and TypeScript passed; the production build passed with **406 generated route entries**. W010 receipt rendering tests are included in the default suite. These results do not substitute for browser, visual, accessibility or Owner/QA acceptance, which remain pending.

## Wave 3 cross-module integration evidence — 15 November 2026

- A new isolated PostgreSQL/API integration scenario traces W007/W008 public selection and submission into the protected R013/R015 staff enquiry queue, staff review into R014 lead qualification, explicit staff lead-to-patient conversion (R004), and an R008 home-collection appointment request.
- Selected catalogue version, home fee choice (₹99) and address survive in the authorized CRM activity; address remains encrypted in storage. The appointment is persisted as `REQUESTED`, with the service fee in a separate field. It does not reserve capacity or imply confirmation.
- A synthetic catalogue version with no verified price creates an order in `PENDING_VERIFICATION` with no total. The F002 collection-job API rejects progression until the diagnostic order is confirmed; the test verifies no collection job was created. This is intentional gating, not a completed order/collection/report/finance workflow.
- The test covers idempotent lead-to-patient, appointment and order retries, centre denial for appointment creation, persisted audit events, and absence of plaintext collection address. It uses a dedicated disposable PostgreSQL schema. No browser session was used against the persistent development database.
- Full suite after this addition: **955/955 across 240 files**; lint, TypeScript, build (406 route entries) and inventory reconciliation passed. Manual visual, responsive, accessibility and Owner/QA acceptance remain pending.
