# Patient & Family Portal Policy Specification

Status: **Draft for Owner, privacy and clinical review. Nothing in this document enables patient access.** This specification separates policy decisions from safe, synthetic-only software engineering. The portal remains no-index and unavailable for real patient data until the required decisions and implementation gates are approved.

## 1. Identity proofing and account linking

- Decide which Rudra-held identifiers and documentary checks establish identity, who may perform and attest to a check, and how failed or conflicting checks are escalated.
- Define matching, duplicate-account prevention, correction requests and the approval path for account-to-patient linking. A phone number, email address, booking reference or family relationship alone must not prove identity.
- Keep identity evidence out of general audit text and logs. Store only the minimum verification outcome, method, actor, timestamp and restricted evidence reference.
- Decide re-verification triggers, verification expiry and how a patient can challenge an incorrect link.

## 2. Patient authentication, sessions and recovery

- Select and approve the patient authentication method, MFA/step-up requirements, retry limits, rate limits and account-enumeration-safe responses.
- Set session idle and absolute lifetimes, renewal rules, device-trust policy, concurrent-session limits, revocation behavior and logout guarantees.
- Define recovery proofing, support-agent boundaries, cooling-off periods and notifications for account recovery or credential changes.
- Require server-side authorization on every request; do not use staff roles, hidden URLs, browser storage or client-supplied patient IDs as patient authority.

## 3. Family and guardian authority

- Require each capable adult to authorize a named representative directly. Define permitted relationship evidence, scope, start/end dates, review cadence and revocation.
- Define guardian authority and evidence for minors or adults lacking decision capacity, including expiry/review and jurisdictional review by counsel.
- Scope grants separately for appointments, orders, billing, reports and documents. Default to no access; family membership never grants medical-record access.
- Log grant creation, review, use, change, expiry and revocation with actor and purpose, without copying clinical content into the audit event.

## 4. Consent, contact and preferences

- Approve separate service-processing, representative-sharing, optional communications and any other legally required consent wording and evidence.
- Specify that declined, withdrawn, expired or missing consent blocks only the corresponding optional action; it must not be silently changed by staff or inferred from a past booking.
- Define permitted communication channels, quiet hours, preference changes, retention and evidence of delivery. Until a provider and policy are approved, no patient message is sent.

## 5. Reports and sensitive documents

- Define which authorized clinical roles approve, correct, supersede, revoke and release a report, and what provenance is required before patient visibility.
- Require verified patient/representative authority, order linkage, centre scope, encryption at rest, malware scanning, private short-lived access, immutable audit and revocation.
- A quarantined, scanner-pending, rejected, superseded or revoked document must not be downloadable. Scanner failure remains fail-closed.
- Approve retention/deletion, legal holds, correction notices, key rotation, historical-key recovery and backup/restore before enabling upload or release.

## 6. Data access, privacy and support

- Apply minimum necessary data to each view; mask sensitive identifiers by default and require a documented purpose for exceptional access.
- Prevent account, patient, family, appointment and report enumeration. Return safe errors that do not confirm another person's existence.
- Keep patient access events auditable; exclude passwords, OTPs, raw document content and unnecessary medical details from application logs and audit payloads.
- Define support verification scripts and escalation paths. General support must not disclose patient or report information solely from a booking reference.

## 7. Approval record required before activation

Owner/privacy/legal/clinical reviewers must record approved values for identity evidence, authentication/MFA, session lifetime and recovery, adult delegation, guardianship, per-data grant scope, consent wording, report release authority, scanning, retention and breach/escalation handling. Until then, synthetic preview only; no patient-owned API, account creation, data collection, document upload, report delivery or production access.

## Safe engineering allowed before approval

Synthetic-only fixtures; isolated authorization and negative-scope tests; API scaffolding that is disabled by default and fails closed; audit schemas without sensitive payloads; UI gate states; session revocation plumbing; encryption/scanner protocol tests; and acceptance automation. No real identity, patient record, report or external provider may be used.
