# Phase 02 — Patient & Family Portal Readiness

Checkpoint: 13 November 2026. This is a dependency and sequencing note, not a claim that portal authentication or patient-data access is implemented or approved.

## Entry gates

Do not enable patient accounts, self-registration, report lookup or family access until the owner has approved and documented:

1. Identity proofing and patient-to-account matching, including duplicate and recovery procedures.
2. Patient authentication, session lifetime/revocation, MFA or step-up requirements, trusted-device rules and secure account recovery.
3. Patient consent, guardian/minor authority, family delegation, revocation and centre scope.
4. Report verification/release, correction, quarantine, audit and authorized support workflows.
5. Encryption key custody, backup/restore, rotation and incident response for account and health data.
6. Approved communication provider, consent and delivery failure policy if notifications are enabled.
7. Screen references, canonical routes, API contracts and a data-minimizing privacy review.

## Safe preparation sequence

1. Reconcile Phase 02 screen IDs/routes against `SCREEN_SPEC_178.md` while preserving canonical IDs.
2. Define threat model, data minimization, RBAC/centre scope and authorization test matrix using synthetic records.
3. Specify account linking and patient/family consent state machines; keep public registration and lookup disabled.
4. Implement isolated synthetic fixtures and negative tests (cross-patient, cross-family, cross-centre, expired/revoked consent, locked session, duplicate identity).
5. Only after written gates are satisfied, build the approved workflow behind server-side authorization and feature controls.
6. Run browser, accessibility, responsive, isolated PostgreSQL and recovery/restore acceptance before any production decision.

## Current evidence boundary

The development repository has Better Auth and staff account/session functionality, but that does not establish patient identity proofing or patient-portal acceptance. W014–W017 remain restricted. No real patient data has been used for this readiness work. Phase 01 automated checks do not qualify Phase 02.
