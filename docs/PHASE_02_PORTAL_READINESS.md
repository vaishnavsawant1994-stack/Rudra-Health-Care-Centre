# Phase 02 — Patient & Family Portal Readiness

Checkpoint: 13 November 2026. The safe UI preview scope has been developed. Patient authentication and protected patient-data access are still not approved or enabled.

## Current state

- P001–P016 now have canonical screen routes and a consistent responsive, no-index preview shell.
- The optional synthetic example is static fictional copy held in component state only. It does not call an API, write to browser storage or PostgreSQL, or represent a Rudra patient/order.
- Patient login, registration, family access, appointment/order history, reports, payments, addresses, reminders, support tickets, notifications, document upload and health trends remain unavailable for real patient data.
- Existing patient, family, appointment, report and finance APIs are staff-authorized. Patient pages do not call them and staff identity is not used as patient identity.
- Current detailed evidence/status: `docs/PHASE_02_PATIENT_ACCEPTANCE.md`.

## Entry gates before enabling protected access

1. Approve identity proofing and patient-account matching, duplicate resolution and account recovery.
2. Approve patient authentication, session lifetime/revocation, MFA/step-up requirements and trusted-device policy.
3. Implement server-side patient-owned APIs and test anonymous, wrong-account, wrong-centre, stale/revoked-session and object-enumeration attempts before returning data.
4. Approve patient consent, adult family delegation, guardian/minor authority, per-data grants, expiry, revocation and audit.
5. Approve report release/correction, encrypted storage, scanner operations and key backup/rotation/restore.
6. Approve legal invoice issuer/tax policy and a payment provider before payments.
7. Approve clinician-reviewed trend methodology, reminder rules, privacy notice and communication providers.
8. Approve screen references and complete manual responsive/accessibility/browser acceptance.

## Development guardrails

Continue with synthetic-only UI and isolated automated tests. Do not seed persistent patient or family demo records, connect portal pages to staff APIs, accept identity/contact details, issue patient-specific links or activate account actions until entry gates are approved. Metropolis remains manual-first; never infer its receipt, processing or report state. No Phase 02 deployment or production data access is authorized.
