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
| W010 | Booking success & next steps | `/booking/success/[id]` | Partial; grouped `/book/confirmation` acknowledgement for accepted enquiry only. | No appointment/slot/payment confirmation; reload receipt recovery absent. | Pending |
| W011 | Home sample collection service | `/home-collection` | Partial; published area guidance and centre links; staff confirmation required. | No approved geographic/zone serviceability engine; no reservation. | Pending |
| W012 | Find centres | `/centres` | Partial; published centre directory, loading/error/retry and directions from published addresses. | Verify published centre records and interaction/accessibility. | Pending |
| W013 | Centre profile & serviceability | `/centres/[id]` | Partial; API-driven published detail/services, retry states and address directions. | Free-text area is informational only; no serviceability decision or capacity. | Pending |
| W014 | Order tracking entry | `/track` | Restricted; privacy-safe explanation/redirect; no order or report lookup. | Identity, order authorization and report-release policy. | Pending |
| W015 | Report access entry | `/reports` | Restricted; patient-facing entry explanatory; staff `/reports` remains protected. | Identity proofing, authorization and report-release workflow. | Pending |
| W016 | Sign up / patient registration | `/register` | Restricted; self-registration disabled. | Approve identity-proofing method/provider and enrollment controls. | Pending |
| W017 | Login / OTP / recover access | `/login` | Restricted; patient authentication/recovery disabled. | Approve patient authentication, MFA/session and recovery policy. | Pending |
| W018 | Corporate diagnostics landing | `/corporate` | Partial; enquiry submits into staff review/relationship workflow; synthetic DB evidence. | No contract or external service implied; authorized legal/commercial review. | Pending |
| W019 | Doctors & referrals landing | `/doctors` | Partial; enquiry path; doctor CRM conversion and audit tested with synthetic data. | No referral qualification or provider integration claimed. | Pending |
| W020 | Partner/franchise enquiry | `/partner` | Partial; intentional redirect to `/partners`; partner enquiry and gated inactive conversion tested synthetically. | No approval/agreement implied; authorized partner review required. | Pending |
| W021 | Contact & help centre | `/contact` | Partial; centre-routed enquiry; staff task assignment uses `tasks.assign` and centre scope. | No external communications provider; verify staff assignment in browser. | Pending |
| W022 | Frequently asked questions | `/faq` | Partial; FAQ/search and safe request wording; route coverage. | Content review and screen-level keyboard/responsive checks. | Pending |
| W023 | Health education / blog | `/health-guides` | Restricted; limited educational content marked pending clinical review and noindex. | Clinical sign-off before public discoverability. | Pending |
| W024 | Health article detail | `/health-guides/[slug]` | Restricted; finite allow-list; unknown slug 404; noindex. | Clinical review and approval of each article. | Pending |
| W025 | Promotions & offers | `/offers` | Restricted; displays only published catalogue packages; no unapproved promotion claim. | Approved pricing, promotions and catalogue publication. | Pending |
| W026 | Privacy, terms, disclosures & accessibility | `/legal/[page]` | Restricted; draft summaries; local cookie preference control does not activate tracking providers. | Legal issuer approval, final notices and consent policy/provider decision. | Pending |

## Evidence from this checkpoint

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
