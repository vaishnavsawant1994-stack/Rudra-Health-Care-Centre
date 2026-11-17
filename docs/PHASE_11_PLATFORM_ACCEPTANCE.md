# Phase 11 — Identity, Security & Platform Administration

**Checkpoint:** 15 November 2026  
**Scope:** S001–S012, original IDs and canonical routes preserved.  
**Status:** Development evidence only. No screen has final manual or release acceptance.

## Controls and source limits

The canonical Phase 11 routes now use current authentication, staff/RBAC, manual Metropolis, catalogue and communication-governance contracts where available. Every protected page is behind `AdminShell`; protected writes continue through APIs with server-side permission checks. A route and a build do not prove live authorization or screen acceptance.

This wave adds no database migration. Source migrations remain through 0100; the persistent local development database was previously observed at 0093 and was not changed. No production records, credentials, secrets or provider connections were accessed. No provider was activated, no communication sent, no export/restore run, and no release/deployment action taken.

## Twelve-screen register

| ID | Canonical screen / route | Current implementation | Backend/database and access evidence | Restricted capability / blocker | Automated/manual status |
|---|---|---|---|---|---|
| S001 | Staff Login, MFA & Sessions `/staff/login` | Reuses the existing protected staff sign-in page; MFA enrollment and TOTP verification retain their dedicated routes. | Better Auth email/password, required TOTP, verified MFA session state, bounded 8-hour session, session list/revocation and server access check. Sign-in and TOTP verification pass `trustDevice: false`; stale trust cookies are stripped. | No public registration or trust-device bypass. Recovery and actual browser/session lifecycle acceptance remain pending. | Existing auth/MFA/session tests; manual browser acceptance pending. |
| S002 | Users & Staff Directory `/admin/users` | Reuses the staff directory and owner-provisioning form. | `/api/admin/staff` and staff detail APIs; `staff.read`/`staff.manage`; organization-level provisioning gate. Role assignment and session revocation remain separate audited screens. | Live role/centre coverage and end-to-end account deactivation/provisioning acceptance remain pending. | Existing staff API tests; live multi-role acceptance pending. |
| S003 | Roles & Fine-Grained Permissions `/admin/access` | Reuses `RolePermissionManager`. | Roles API, role-permission catalog and separate centre-scoped assignment API; owner-only unscoped role-definition management. APIs remain the enforcement point. | Live self-escalation, grant matrix and cross-centre acceptance remain pending. | Existing permission/API tests; independent authorization review pending. |
| S004 | Consent & Privacy Console `/admin/privacy` | Permission-gated restricted state. Existing consent and family-sharing controls remain in their modules. | Patient, family grant/contact and lead marketing-consent records exist; no consolidated privacy-request API is mapped. | No privacy request case, authorized export, erasure execution or retention job. Legal notice/retention basis and identity/authority checks are open. | No console workflow tests; no privacy operation is claimed. |
| S005 | System Configuration & Feature Flags `/admin/config` | Read-only system setup status plus explicit non-activation boundary. | `/api/admin/system` requires `configuration.read`; it reports current database/authentication/scanner setup checks. `application_configuration` exists, but no versioned flag proposal/approval/apply API was found. | No owner-controlled versioned feature flags, rollback proposal or apply/verify state. Provider status is not inferred from a flag. | Existing system API tests; config change workflow unavailable. |
| S006 | Metropolis Adapter Configuration `/admin/integrations` | Reuses centre-authorized manual reference mapping and links to manual import readiness. | Existing encrypted, centre-scoped, idempotent Metropolis reference/mapping workflow; `samples.read` and write-specific grants. | API credentials, provider permission, data-use terms, validated import contract and automatic synchronization remain unavailable. | Existing reference/import policy and API tests; no provider integration tested or enabled. |
| S007 | Integration Events & Failures `/admin/integration-events` | Displays reviewed, staff-recorded Metropolis status evidence. | Existing encrypted, append-only, centre/order-scoped status event and review APIs. | Not a provider event stream or failure/retry queue; no provider event ingestion or automatic retry. Staff-recorded evidence is not provider confirmation. | Existing Metropolis route/policy/crypto tests; provider behavior unverified. |
| S008 | Catalogue Pricing & Promotions `/admin/catalogue` | Reuses authorized catalogue price review and links to import/catalogue routes. | Catalogue version/source/verification records and price-review API; `catalogue.price.verify`. | Promotion approval/publication is not implemented here. Unverified/stale prices stay unapproved; home-collection fee remains separate. | Existing catalogue policy/publication/import tests; no promotion acceptance. |
| S009 | Document Templates & Legal Issuers `/admin/documents` | Permission-gated restricted state. Communication templates are not represented as legal documents. | Existing report/template workflows are separate and do not establish legal issuer authority. | Invoice issuer, tax, settlement, franchise permissions and legal template approvals remain unresolved; this route issues no invoice/report. | No legal issuer workflow test; operation remains unavailable. |
| S010 | Backups, Exports & Recovery `/admin/recovery` | Read-only system checks with explicit recovery qualification blockers. | `/api/admin/system` reports setup checks; key recovery and migration qualification scripts exist. No verified backup inventory/restore evidence API or export request workflow was found. | No backup/export/restore action. Migration gap 0093→0100, encrypted-document restore, key recovery/rotation and recovery evidence remain P0 blockers. | No restore or export executed; disposable-schema tests are not a restore qualification. |
| S011 | Notifications, Integrations & Task Automation `/admin/automation` | Reuses encrypted, versioned, centre-scoped provider-policy drafts and links to task approval policies. | Communications governance API enforces `configuration.manage`, idempotency, encryption and append-only audit events. | Draft-only. No outbound messages, provider delivery, scheduled job execution or automation status is claimed. Recipient consent, quiet-hours and provider readiness still gate activation. | Existing governance API and isolated DB tests; live dispatch disabled. |
| S012 | Change Log, Releases & Acceptance `/admin/releases` | Read-only summary generated from the 178-row source matrix; no release actions. | Counts are generated by `scripts/reconcile-screen-inventory.mjs`; protected by `configuration.read`. Release summary tests reconcile totals and assert zero accepted unless evidence exists. | No CI/Git release tag, deployment, rollback, owner approval or visual-reference feed. Current route counts are not acceptance counts. | Matrix release summary tests; manual visual, browser, accessibility and final owner/QA acceptance pending. |

## Evidence categories in the 178-screen matrix

The CSV now keeps separate columns for visual reference, frontend route/source, candidate API, candidate schema, permission/privacy evidence, integration readiness, related test candidates, manual desktop/mobile, accessibility/responsive, final Owner/QA acceptance and deployment readiness. The candidate columns are explicitly not proof that a control works. All screen-specific manual and final acceptance fields remain pending unless separately evidenced.

## Phase 11 checks

Verification completed 15 November 2026: full Vitest **951/951 across 239 files**; focused Phase 11 authorization and inventory suite **23/23 across five files**; ESLint passed; TypeScript passed; production build passed and generated **405 static pages**. Inventory reconciliation generated 178 rows and the release summary. New route-policy tests cover denied role reads and changes, wrong-centre assignments, org-wide provisioning denial for centre-only staff, and CSRF rejection before session revocation. Existing source tests cover MFA/session policy, Metropolis evidence, catalogue pricing and communications governance. These tests cover source contracts; they do not amount to live browser, provider or owner acceptance. No persistent database migration or standalone `db:integration` command was run.

## Unresolved Phase 01–10 blockers carried forward

- Patient identity proofing and patient/representative authority; sensitive report access and encryption key recovery.
- Clinical report release, critical-result protocol and approved SOPs.
- Metropolis permission, import contract, data-use terms and provider verification.
- Invoice issuer, tax, settlement, catalogue pricing and promotions approval.
- Offline collection, barcode and centre capacity/service-area contracts.
- Phase 10 capacity, SLA, incident/CAPA, SOP/training, inventory and procurement data models/policies.
- External payment, messaging, calling, AI and social/marketing provider qualification.
- Persistent DB migration preflight, encrypted-document backups, restore and key-recovery qualification.
- Full 178-screen desktop/mobile visual comparison, accessibility and manual UAT.

Phase 11 does not establish production readiness. Keep all 12 screens pending manual review and do not enable unsupported administrative actions.
