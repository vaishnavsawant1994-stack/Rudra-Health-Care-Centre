# Phase 03 — Reception, CRM & Front Desk (R001–R018)

Checkpoint: 13 November 2026  
Baseline: `872eeebfd05adc30edb90490bbe4d3b2369add91` (`master`)  
Scope: source review, protected route wiring, existing staff APIs/workflows, tests, and evidence reconciliation. Synthetic data only. No production access, deployment, database changes, commit, or push.

## Result

Phase 03 is **partially implemented; not complete or accepted**. Existing protected surfaces cover much of the operational flow. This checkpoint adds aliases from the canonical R screen routes to those existing surfaces and sends already-authenticated staff from `/staff` directly to their role-scoped workspace. Each destination still checks its own staff session and permissions. No database migration was added.

The requested manual desktop/mobile acceptance campaign remains deferred. A canonical route resolving to an existing module is route evidence, not proof every screen requirement works.

## Screen-by-screen status

`Test evidence` below refers to existing test files found in source; this table does not imply they passed in this checkpoint unless the verification section says so. All final acceptance is pending.

| ID | Screen and canonical route | Implementation evidence / current status | Main limitation or gate | QA / acceptance |
|---|---|---|---|---|
| R001 | Staff workspace home `/staff` | Implemented: authenticated `/staff` now redirects to `/staff/workspace`; staff workspace and role-scoped queues exist. | Workspace panels and queue freshness are module dependent. | Automated route change checked by typecheck/lint/build; manual acceptance pending. |
| R002 | Patient search & duplicate review `/crm/patients` | Partial: alias to `/patients`; encrypted centre-scoped lookup and registration duplicate checks exist. | No dedicated fuzzy duplicate review or merge-request workflow. | Patient search/registration tests exist; final acceptance pending. |
| R003 | Staff Patient 360 `/crm/patients/:id` | Partial: alias to `/patients/:id`; authorized profile and permission-separated histories exist. | Full cross-domain history depends on each module permission. | Patient API/profile tests exist; final acceptance pending. |
| R004 | Register/update patient `/crm/patients/new` | Implemented for safe staff registration/update: consent defaults and duplicate guard exist. | Staff entry is not independent identity proofing; no portal identity is created. | Patient create/update tests exist; final acceptance pending. |
| R005 | Family links/dedup/consent `/crm/families` | Partial: alias to `/families`; explicit pending/verified family links and sharing grants exist. | Patient merge and identity-correction approval are absent. No merge is performed. | Family membership/grant tests exist; merge acceptance blocked by missing workflow/policy. |
| R006 | Patient activity timeline `/crm/patients/:id/timeline` | Partial: alias redirects to Patient 360 timeline anchor; recorded activity appears within the profile. | Embedded timeline only; linked history remains separately permissioned. | Patient activity API evidence exists; visual/manual acceptance pending. |
| R007 | Appointment calendar `/staff/appointments` | Implemented: alias to `/appointments/calendar`; day/week/month appointment views are available. | Calendar shows recorded appointments; it does not infer open capacity. | Calendar/API tests exist; manual acceptance pending. |
| R008 | Create/edit appointment `/staff/appointments/new` | Partial: alias to `/appointments/new`; protected booking-request creation and update flows exist. | A request does not reserve capacity or become a confirmed appointment automatically. | Appointment DB/API tests exist; scheduling-conflict and live workflow acceptance remain pending. |
| R009 | Create test order/quote `/staff/orders/new` | Partial: alias to `/orders/new`; order drafts use eligible catalogue snapshots. | No lab/sample processing or payment is triggered. | Order API tests exist; full operator acceptance pending. |
| R010 | Order detail/status `/staff/orders/:id` | Partial: alias to `/orders/:id`; authorized order detail, controlled draft changes and history exist. | Lab, report, collection, and invoice lifecycles are separate and not fabricated. | Order detail tests exist; final acceptance pending. |
| R011 | Walk-in tokens/queue `/staff/queue` | Partial: alias to the Reception role workspace. Queue actions require confirmed appointment and recorded arrival. | No separate no-show/redirect actions or QR identity scan. | Queue tests exist; manual reception acceptance pending. |
| R012 | Today arrivals/check-in `/staff/check-in` | Partial: alias to `/appointments/arrivals`; arrival is recorded for eligible appointments. | QR scanning and identity verification are not implemented by this flow. | Check-in tests exist; identity/QR requirements remain open. |
| R013 | Leads inbox/capture `/crm/leads` | Implemented for staff lead capture and public enquiry review via the protected CRM. | Contact permission is distinct from lead creation and marketing consent. | Lead and public enquiry tests exist; final acceptance pending. |
| R014 | Lead detail/follow-up `/crm/leads/:id` | Implemented: alias to `/leads/:id`; activity, assignment, follow-up and authorized conversion flows exist. | Conversion is limited by explicit matching, permissions, and lifecycle rules. | Lead conversion/follow-up tests exist; manual acceptance pending. |
| R015 | Calls/enquiries/callbacks `/staff/enquiries` | Partial: alias to public-enquiry staff review. Consent-gated manual contact-attempt logging and callback tasks exist. | No telephony, SMS, email, WhatsApp, or voice provider is connected; no calls are placed. | Lead activity/follow-up tests exist; provider functionality intentionally absent. |
| R016 | Staff test catalogue `/staff/catalogue` | Partial: alias to `/catalogue/tests`; catalogue verification and version-aware records exist. | Unverified catalogue entries/prices cannot be quoted as approved customer prices. | Catalogue API/tests exist; human review of catalogue correctness remains pending. |
| R017 | Price & offer quote `/staff/quotes` | Partial: protected internal quote drafts use currently effective verified INR catalogue versions and separate ₹75/₹99/₹150 home-visit fee options. | Promotions/customer sending/payment are unavailable; waiver requires a reason. Metropolis remains manual-first. | Quote API/DB tests exist; quote is not an approved external offer. |
| R018 | Front-desk handover `/staff/handover` | Partial: alias to encrypted, centre-scoped handover workbench; recipient acknowledgment and history exist. | Snapshot counts are historical; this does not transfer cash, tasks, appointments, or ownership. | Handover tests exist; real shift acceptance pending. |

## Exact remaining blockers

1. **R005 merge and identity correction:** there is no patient merge or correction approval API, immutable merge plan, approval policy, reference-repoint procedure, or rollback/forensic process. Do not merge records until those controls are designed and tested.
2. **R008/R011/R012 capacity and identity:** current booking/check-in supports request and recorded-arrival transitions; no verified availability reservation, QR scan, or identity-proofing integration is evidenced.
3. **R015 provider actions:** staff can log authorized manual contact attempts and schedule callbacks, but external telephone and message providers are not connected.
4. **R017 publication:** quote drafts are internal snapshots only. Approved promotion policy, issuer/legal approvals and customer delivery remain unavailable.
5. **R018 work transfer:** handovers acknowledge responsibility but do not reassign work or financial balances.
6. **All screens:** complete action-by-action test coverage and manual keyboard, accessibility, responsive, and visual acceptance are still required.

## Prioritized correction register and measurable acceptance gates

| Priority | Work item | Automated acceptance gate |
|---|---|---|
| P0 | Patient identity correction and duplicate merge request/approval | Two centre-scoped synthetic duplicates can produce one immutable proposal; unauthorized, cross-centre, stale-version, self-approved, or unapproved merges make zero patient/reference changes; approval/rejection and any approved merge each create append-only audit events. |
| P1 | Appointment capacity, rescheduling and duplicate protection | Concurrent requests for a single synthetic capacity unit cannot both reserve it; request/confirmed/arrived states remain distinct; retries with the same idempotency key create one state transition; wrong-centre actions return no record. |
| P1 | Registration and patient link privacy | Patient profile/contact fields stay encrypted at rest; exact duplicate checks remain centre-scoped; family membership without an active explicit grant returns no protected data; audit payloads contain no raw contact values. |
| P1 | Lead handoff and callback | Public enquiry is visible only with centre-scoped lead permission; denied consent blocks contact attempts; permitted follow-up retries are idempotent; conversion creates one linked patient/appointment only after explicit staff action. |
| P1 | Quote integrity | Quote lines reference active, currently effective verified catalogue versions; home fee is a separate allowed value (₹75/₹99/₹150) or reason-backed waiver; stale/unverified price is rejected; quote creation sends no message and records no payment. |
| P2 | Reception handover | Only assigned incoming staff or an authorized manager can acknowledge/cancel within centre; duplicate action produces one history event; historical workload snapshot is labeled with capture time and never changes ownership. |
| P2 | Canonical routes and accessibility | Each R route resolves to the intended protected target; unauthenticated and wrong-role requests remain denied; every form has keyboard-operable controls, labels, validation feedback and responsive layout checks before manual acceptance. |

## Next implementation sequence

1. Design and test the non-destructive identity-correction/merge proposal and approval contract before any database merge operation.
2. Add concurrency-focused appointment capacity semantics only after approved capacity policy is specified; retain booking-request language until then.
3. Add API integration coverage for lead queue centre authorization, permitted callback activity, appointment conversion and audit privacy.
4. Complete route-level automated checks for all aliases, then run the deferred manual browser/visual campaign against approved references.
5. Keep payment, telephony/messaging providers, Metropolis API exchange, legal issuer approval, QR identity proofing and production readiness gated on verified configuration and authorization.

## Architecture and safety evidence

- Canonical R routes now redirect to existing staff-protected module routes. The target pages/APIs remain the authorization boundary; aliases do not grant access.
- Patient, family, lead, quote, appointment/order, and handover routes use existing domain services and PostgreSQL schema. No duplicate schema or migration was introduced.
- Patient and lead private fields use the existing encryption/blind-index paths. The phase uses synthetic data only; no synthetic records were inserted into the database.
- Public enquiries remain enquiries until staff explicitly performs a permitted workflow. Appointment requests do not imply slot reservation or confirmation.
- Metropolis remains manual-first; no external lab result, sample, payment, or provider event is fabricated.

## Verification

The updated 178-screen matrix was regenerated from the repository screen specification and source inventory. `git diff --check` reported only normal line-ending notices. `npm.ps1` is blocked by the machine execution policy; checks were invoked using `npm.cmd`. Full Vitest passed **902/902 across 221 files** after updating inventory route assertions; focused reconciliation passed **12/12**. TypeScript and ESLint passed. Guarded PostgreSQL integration passed with **98 migrations replayed** and synthetic permission/audit/domain checks. The production build passed and generated **317/317 static pages**; dynamic pages were retained for on-demand server rendering. No manual browser campaign was run.

## Phase 04 readiness

Phase 04 is **not ready for live integration**. Safe next development is to design a non-destructive, approval-controlled patient correction/merge request workflow and expand automated negative-scope tests. Metropolis API/permissions, legal issuer, payment/provider configuration, verified slot capacity, and live identity-proofing require separate evidence and authorization. Continue synthetic-only and manual-first operation until those gates are resolved.

## Wave 3 connected-workflow test — 15 November 2026

The public-enquiry PostgreSQL integration suite now includes one scenario that submits an enquiry, reviews it through the protected centre-scoped queue, converts it to a lead, qualifies that lead, creates a patient record through the explicit staff conversion API, and creates an idempotent appointment request linked to both lead and patient. The same scenario verifies that the appointment status stays `REQUESTED`, its selected home fee remains separate, a wrong-centre appointment create is denied, and the appointment is not described as a reservation or confirmation. This is API/database evidence with mocked access grants and synthetic records, not a browser login or live staff-session acceptance.
