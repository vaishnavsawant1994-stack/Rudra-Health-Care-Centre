# Phase 02 — Patient & Family Portal (P001–P016)

Checkpoint: 13 November 2026

## Status summary

| Measure | Result |
|---|---:|
| Canonical Phase 02 screens mapped | 16/16 |
| Safe patient-portal preview routes | 16/16 |
| Protected patient data/API flows enabled | 0/16 |
| Patient workflows fully implemented and accepted | 0/16 |
| Manual desktop/mobile and accessibility acceptance | Pending for all 16 |

The screens now have a consistent Rudra patient/family preview, canonical route coverage, accessible navigation, explicit identity/consent gates and an opt-in synthetic scenario panel. The scenario panel uses only static, fictional workflow copy in page memory: it makes no API request, writes no browser storage and changes no database records. It does not show names, contact details, addresses, patient identifiers, invoices, clinical values or report files. It does not claim a Metropolis receipt, processing, completed collection or report release.

This is an implementation of the **safe preview/UI scope**, not a live patient portal. Existing patients/families/reports/appointments/finance APIs are staff-authorized and are not called by patient pages. Staff authentication is not reused as patient identity. Registration and patient sign-in remain disabled.

## Screen-by-screen inventory

| ID | Canonical screen and route | Current implementation evidence | Restriction / remaining work | QA and acceptance |
|---|---|---|---|---|
| P001 | Patient home / health overview — `/account` | Screen shell and preview navigation; safe enquiry link; synthetic example is clearly marked. | Patient dashboard summaries require approved patient identity and patient-authorized read APIs. | SSR route safety test; manual viewport/accessibility review pending. |
| P002 | My profile & identity — `/account/profile` | Profile and identity gate; no personal fields are loaded or editable. | Approve proofing, verification, change and audit workflows. | SSR gate test; manual review pending. |
| P003 | Family dashboard — `/account/family` | No family data; states that relationship alone grants no access. | Approve account linking, adult consent and guardian eligibility. | SSR gate test; family policy tests remain staff-side only. |
| P004 | Member 360 & access management — `/account/family/[id]` | Canonical dynamic route resolves to a no-data member preview; synthetic grant is pending verification. | No patient-facing grant creation/read/revoke API; guardian proof and owner consent policy required. | SSR route test; existing family-policy tests cover pending, expired, revoked, wrong-scope grants. Manual review pending. |
| P005 | Order care-journey timeline — `/account/orders/[id]/journey` | New canonical nested route; no-data timeline; explicitly marks external/lab milestones unverified. | Patient ownership API and approved event projection required. | SSR route safety test; no live workflow or visual acceptance. |
| P006 | My bookings & appointments — `/account/appointments` | New canonical appointments route; no appointments/slots; booking request stays distinct. | Patient-authenticated appointment history and current server authorization required. | SSR route safety test; manual review pending. |
| P007 | Reschedule / cancel request — `/account/appointments/[id]/change` | New canonical change route; action is disabled without a verified appointment. | Patient ownership, capacity, cancellation/refund policy and audited mutation required. | SSR route safety test; no mutations enabled. |
| P008 | Orders & sample history — `/account/orders` | No patient order rows; external receipt, processing and collection explicitly unverified. | Patient-authorized order projection and provenance controls required. | SSR gate test; no operational event is simulated as fact. |
| P009 | My medical reports & sharing — `/account/reports` | No reports/results/files; download and sharing unavailable. | Patient identity, report release, family ACL, scanner and revocation workflow required. | SSR gate test; staff report-policy tests do not prove patient access. |
| P010 | Bills, receipts & payment history — `/account/billing` | No bill, amount, receipt, balance or payment; provider unavailable. | Legal issuer/tax, patient/payer association and payment-provider approval required. | SSR gate test; no payment action. |
| P011 | Addresses & collection preferences — `/account/addresses` | No address inputs or location check; serviceability is not inferred. | Patient identity, encrypted address storage, retention and approved zone logic required. | SSR gate test; no personal data collected. |
| P012 | Health calendar & reminders — `/account/calendar` | Empty accessible calendar illustration; no events/reminders scheduled or sent. | Patient event projection, clinician recall policy and notification provider/consent required. | SSR gate test; manual review pending. |
| P013 | Help, complaints & support tickets — `/account/support` | Categories and public-contact link; no patient ticket is submitted. | Patient ticket ownership, private message policy, SLA and communications approval required. | SSR gate test; no message sent. |
| P014 | Notifications and channel preferences — `/account/notifications` | No delivery history; channels not persisted or connected. | Patient consent/preferences API, DND policy and approved providers required. | SSR gate test; no delivery asserted. |
| P015 | Document vault / health passport — `/account/health-documents` | New canonical route; no upload or document shown. | Patient identity, encrypted storage, malware scan qualification, provenance, access/revocation and retention required. | SSR route safety test; file action disabled. |
| P016 | Comparable health trends — `/account/health-trends` | New canonical route; no clinical values, charts or comparisons. | Released results, approved comparable-analyte methodology and clinician review required. | SSR route safety test; no clinical interpretation. |

## Source and automated evidence

- Screen routes and scenario copy: `src/lib/patient-portal-preview-data.ts`.
- Shared responsive preview, navigation and access gates: `src/components/patient/patient-portal-preview.tsx` and `src/app/rudra-access-pages.css`.
- Canonical route files: `src/app/account/page.tsx`, existing profile/family/orders/reports/billing/address/calendar/support/notification routes, and new appointments, order-journey, document-vault and health-trends routes.
- Route/source matrix regenerated from `SCREEN_SPEC_178.md` with `node scripts/reconcile-screen-inventory.mjs`; dynamic route parameter names are normalized for route matching without changing the original route or ID.
- Preview coverage tests verify all 16 screen IDs/routes, no-index metadata, the identity gate, absence of personal-input forms in the preview, and synthetic scenarios that avoid clinical values and unverified laboratory milestones.
- Existing `src/server/family-policy.test.ts`, `src/server/patient-policy.test.ts` and `src/server/report-policy.test.ts` cover staff-side policy helpers and are not considered proof of a patient portal endpoint.

No migration was required. No patient-facing API was added. No synthetic person or sample record was written to PostgreSQL.

## Entry gates before real patient workflows

1. Owner-approved identity proofing, duplicate resolution, patient-account linking, session/revocation, MFA/step-up and recovery policy.
2. Patient-owned, server-side APIs with cross-account/centre authorization tests; no reuse of staff roles as patient identity.
3. Adult family consent and documented guardian authority; data-specific grants, expiry and revocation with audit.
4. Report release authority and scanner/storage/key lifecycle qualification before patient report access or document upload.
5. Legal invoice issuer/tax policy and approved payment provider before bill/payment actions.
6. Clinical comparability approval before trends; reminder consent/policy and provider before notifications.
7. Approve the original patient-portal design references and perform manual desktop/tablet/mobile, keyboard and assistive-technology acceptance.

## Phase 03 readiness

Phase 03 is described in `docs/PHASES_AND_ACCEPTANCE.md` as Metropolis synchronization and verified availability. Rudra remains manual-first. No provider credentials, contract, mapping approval or verified external status feed are established by this Phase 02 preview work; integration, availability claims and automatic external ordering remain blocked. Continue with an approved manual-first operational milestone or wait for formal provider prerequisites rather than treating this portal checkpoint as Metropolis integration readiness.
