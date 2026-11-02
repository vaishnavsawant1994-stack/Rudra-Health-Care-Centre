# Rudra Health OS — Clean Architecture Blueprint

## Topology
One modular monolith with a Next.js application, protected server/domain layer, PostgreSQL and background job adapter. Use a single application with separately authorized route experiences. Add worker processes and integration adapters as needed, not duplicated customer databases.

## Route experiences
- Public: `/`, `/tests`, `/packages`, `/home-collection`, `/book`, `/contact`, `/centres`.
- Patient: `/account`, `/account/family`, `/account/orders`, `/account/journey`, `/account/reports`, `/account/payments`.
- Staff: `/staff`, `/staff/patients`, `/staff/appointments`, `/staff/orders`, `/staff/collections`, `/staff/billing`.
- Field: `/field/today`, `/field/jobs`, `/field/handover` (may share authenticated staff shell).
- Branch: `/branch/receiving`, `/branch/dispatch`, `/branch/lab-status`, `/branch/reports`.
- Owner: `/owner`, `/owner/action-centre`, `/owner/staff`, `/owner/finance`, `/owner/quality`, `/owner/analytics`.
- Marketing: `/marketing`, `/marketing/content`, `/marketing/calendar`, `/marketing/approvals`, `/marketing/inbox`.
- AI: `/communications`, `/communications/ai`, `/communications/calls`, `/communications/inbox`.

Use the 178 stable screen IDs from `SCREEN_SPEC_178.md` to track coverage, even where routes are consolidated.

## Core domain entities
Organization, Centre, StaffUser, Role, Permission, Assignment, Shift, AuditEvent, ConsentEvent, Patient, PatientIdentity, FamilyRelationship, FamilyAccessGrant, ContactMethod, Address, Lead, LeadActivity, Doctor, Corporate, Partner, CatalogueTest, CataloguePackage, PackageComponent, CataloguePriceVersion, Promotion, Quote, Appointment, ServiceOrder, OrderItem, VisitAssignment, CollectionJob, Specimen, SampleCustodyEvent, ExternalLabReference, LabStatusVerification, LabReport, TimelineEvent, InvoiceRecord, Payment, Refund, Settlement, Communication, SupportTicket, MarketingAccount, ContentDraft, ApprovalRequest, Campaign, InventoryItem, InventoryMovement.

## Event structure
All verified milestone changes must include organization_id, centre_id, patient_id, order_id when applicable, event_type, source (`STAFF`, `BRANCH`, `METROPOLIS_API`, `VERIFIED_IMPORT`, etc.), status, occurred_at, recorded_at, actor/service identity, evidence reference, verification state, visibility policy and correlation/idempotency identifier.

## Invariants
- Server authorization and centre/patient scoping on every read and write.
- A patient owns their own identifiable health records; family links are not implicit grants to an adult's clinical documents.
- Payments are verified through gateway/webhook or reconciliation; manual cash entries show payer/collector and audit.
- Legal invoice records identify the actual issuer and unique external document reference. No double-invoicing.
- Fees for tests and packages follow approved Metropolis versions; home collection is a separate line.
- No fabricated lab statuses; unknown lab state shows `Awaiting verification`.
- Audit and custody history append only; corrections create new events.
- External integrations are swappable adapters; the core workflow does not depend on a live API.

## Security baseline
Staff OIDC + MFA; secure patient authentication; CSRF-safe authenticated writes, input validation, rate limiting, encryption, short-lived signed file access, managed secrets, backups and restore tests, access logs, restricted exports, customer consent and safe medical communication. No real patient data in dev, fixtures, analytics samples, bug reports or public repositories.

## Phase 01 implementation
The current foundation uses Next.js App Router, Better Auth email/password with required TOTP for protected sessions, PostgreSQL-backed sessions, and Drizzle ORM with checked SQL migrations. Public sign-up is disabled. Server DAL checks permissions and centre scope for protected routes; mutating APIs enforce same-origin requests. Audit events are append-only and linked by a SHA-256 hash chain. See `PHASE_01_SETUP.md` for qualification and residual checks.

## Patient data foundation (P2-01)

Patient API operations require `patients.read`, `patients.create`, or `patients.update` and scope every result by organization and authorized centre. `patient_relationships` is separate from patient access: a family link is not an authorization grant. Registration records consent status and method, but does not establish legal basis or replace approved consent text. Audit details contain operation metadata, never patient values. Patient phone, email, preferred name, date of birth, sex-at-registration and address are stored in `patient_contact_secrets` as AES-GCM ciphertext, with exact-match phone/email HMAC blind indexes; first/last name and the internal patient number remain plaintext. Lead, family, appointment, sample and financial sensitive fields are also not yet fully encrypted. Use synthetic data only until remaining field coverage, key lifecycle, retention, backups, monitoring, privacy review and production controls are qualified.

## Report intake and document boundary (P2-08)

Report intake is manual-first. Report documents are written only to ignored development storage outside `public/`, encrypted at rest with AES-256-GCM under a local key ring; metadata contains a checksum, key ID and scan status. Missing or unavailable ClamAV leaves documents quarantined and blocks preview, download, verification and release. Verification checks the report/order/patient association and provenance, not clinical findings. Delivery records are staff-mediated physical handoffs only. There is no patient-facing report link or external message transport. Patient/contact and operational database fields remain plaintext; production key management, ACLs, scanner operations, retention, backups and restore controls are not qualified. Synthetic data and documents only.

## Design baseline
Accessible, mobile-first, fast, calm healthcare design. Rudra identity is dominant; partner marks and claims require approval. Use restrained professional colors and design tokens; treat any starting palette as provisional until owner approves visual identity.
