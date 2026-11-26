# Phase 11 — Identity, Security & Platform Administration

**Checkpoint:** 15 November 2026  
**Scope:** S001–S012, original IDs and canonical routes preserved.  
**Status:** Development evidence only. No screen has final manual or release acceptance.

## Controls and source limits

The canonical Phase 11 routes now use current authentication, staff/RBAC, manual Metropolis, catalogue and communication-governance contracts where available. Every protected page is behind `AdminShell`; protected writes continue through APIs with server-side permission checks. A route and a build do not prove live authorization or screen acceptance.

The original Phase 11 checkpoint added no migration. A cross-phase correction now exists at migration 0102 to register the organization-scoped `audit.read` permission used by O015; migrations 0102 and prior were exercised only by the isolated GitHub Actions database. The persistent local development database was previously observed at 0093 and was not changed. No production records, credentials, secrets or provider connections were accessed. No provider was activated, no communication sent, no export/restore run, and no release/deployment action taken.

## Twelve-screen register

| ID | Canonical screen / route | Current implementation | Backend/database and access evidence | Restricted capability / blocker | Automated/manual status |
|---|---|---|---|---|---|
| S001 | Staff Login, MFA & Sessions `/staff/login` | Reuses the existing protected staff sign-in page; MFA enrollment and TOTP verification retain their dedicated routes. | Better Auth email/password, required TOTP, verified MFA session state, bounded 8-hour session, session list/revocation and server access check. Sign-in and TOTP verification pass `trustDevice: false`; stale trust cookies are stripped. | No public registration or trust-device bypass. Recovery and actual browser/session lifecycle acceptance remain pending. | Existing auth/MFA/session tests; manual browser acceptance pending. |
| S002 | Users & Staff Directory `/admin/users` | Reuses the staff directory and owner-provisioning form. | `/api/admin/staff` and staff detail APIs; `staff.read`/`staff.manage`; organization-level provisioning gate. Role assignment and session revocation remain separate audited screens. | Live role/centre coverage and end-to-end account deactivation/provisioning acceptance remain pending. | Existing staff API tests; live multi-role acceptance pending. |
| S003 | Roles & Fine-Grained Permissions `/admin/access` | Reuses `RolePermissionManager`; the duplicate initial catalog fetch was removed, requests are cancelled/sequence-guarded, and failed loads expose a retry. | Roles API, role-permission catalog and separate centre-scoped assignment API; owner-only unscoped role-definition management. APIs remain the enforcement point. | Live self-escalation, grant matrix and cross-centre acceptance remain pending. | Focused catalog loading tests added; live role-change browser acceptance and independent authorization review pending. |
| S004 | Consent & Privacy Console `/admin/privacy` | Permission-gated restricted state. Existing consent and family-sharing controls remain in their modules. | Patient, family grant/contact and lead marketing-consent records exist; no consolidated privacy-request API is mapped. | No privacy request case, authorized export, erasure execution or retention job. Legal notice/retention basis and identity/authority checks are open. | No console workflow tests; no privacy operation is claimed. |
| S005 | System Configuration & Feature Flags `/admin/config` | Read-only system setup status plus explicit non-activation boundary. | `/api/admin/system` requires `configuration.read`; it reports current database/authentication/scanner setup checks. `application_configuration` exists, but no versioned flag proposal/approval/apply API was found. | No owner-controlled versioned feature flags, rollback proposal or apply/verify state. Provider status is not inferred from a flag. | Existing system API tests; config change workflow unavailable. |
| S006 | Metropolis Adapter Configuration `/admin/integrations` | Reuses centre-authorized manual reference mapping and links to manual import readiness. | Existing encrypted, centre-scoped, idempotent Metropolis reference/mapping workflow; `samples.read` and write-specific grants. | API credentials, provider permission, data-use terms, validated import contract and automatic synchronization remain unavailable. | Existing reference/import policy and API tests; no provider integration tested or enabled. |
| S007 | Integration Events & Failures `/admin/integration-events` | Displays reviewed, staff-recorded Metropolis status evidence. | Existing encrypted, append-only, centre/order-scoped status event and review APIs. | Not a provider event stream or failure/retry queue; no provider event ingestion or automatic retry. Staff-recorded evidence is not provider confirmation. | Existing Metropolis route/policy/crypto tests; provider behavior unverified. |
| S008 | Catalogue Pricing & Promotions `/admin/catalogue` | Reuses authorized catalogue price review and links to import/catalogue routes. The review queue now clears rows on centre switch, aborts/ignores stale requests, and offers retry after load failure. A successful review followed by a failed queue refresh is reported as saved with refresh pending. | Catalogue version/source/verification records and price-review API; `catalogue.price.verify`. | Promotion approval/publication is not implemented here. Unverified/stale prices stay unapproved; home-collection fee remains separate. | Existing catalogue policy/publication/import tests; browser review journey still pending. |
| S009 | Document Templates & Legal Issuers `/admin/documents` | Permission-gated restricted state. Communication templates are not represented as legal documents. | Existing report/template workflows are separate and do not establish legal issuer authority. | Invoice issuer, tax, settlement, franchise permissions and legal template approvals remain unresolved; this route issues no invoice/report. | No legal issuer workflow test; operation remains unavailable. |
| S010 | Backups, Exports & Recovery `/admin/recovery` | Read-only system checks with explicit recovery qualification blockers. | `/api/admin/system` reports setup checks; key recovery and migration qualification scripts exist. No verified backup inventory/restore evidence API or export request workflow was found. | No backup/export/restore action. Migration gap 0093→0100, encrypted-document restore, key recovery/rotation and recovery evidence remain P0 blockers. | No restore or export executed; disposable-schema tests are not a restore qualification. |
| S011 | Notifications, Integrations & Task Automation `/admin/automation` | Reuses encrypted, versioned, centre-scoped provider-policy drafts and links to task approval policies. | Communications governance API enforces `configuration.manage`, idempotency, encryption and append-only audit events. | Draft-only. No outbound messages, provider delivery, scheduled job execution or automation status is claimed. Recipient consent, quiet-hours and provider readiness still gate activation. | Existing governance API and isolated DB tests; live dispatch disabled. |
| S012 | Change Log, Releases & Acceptance `/admin/releases` | Read-only summary now separates scoped functional browser paths, technical completion, restricted classifications, and Owner/QA acceptance. The evidence ledger is explicit and validated against canonical IDs; no release actions are exposed. | Counts derive from the 178-row source matrix plus `docs/SCREEN_FUNCTIONAL_EVIDENCE.json`; route/build evidence is not promoted to functional evidence. Protected by `configuration.read`. | No CI/Git release tag, deployment, rollback, owner approval or visual-reference feed. Nine scoped paths are recorded; the other 169 have no functional evidence in this focused ledger, which does not imply absence of implementation. | Inventory regression verifies evidence count and category separation; page browser, accessibility, visual and final owner/QA acceptance remain pending. |

## Evidence categories in the 178-screen matrix

The CSV now keeps separate columns for visual reference, frontend route/source, candidate API, candidate schema, permission/privacy evidence, integration readiness, related test candidates, manual desktop/mobile, accessibility/responsive, final Owner/QA acceptance and deployment readiness. The candidate columns are explicitly not proof that a control works. All screen-specific manual and final acceptance fields remain pending unless separately evidenced.

## Phase 11 checks

Verification completed 15 November 2026: full Vitest **951/951 across 239 files**; focused Phase 11 authorization and inventory suite **23/23 across five files**; ESLint passed; TypeScript passed; production build passed and generated **405 static pages**. Inventory reconciliation generated 178 rows and the release summary. New route-policy tests cover denied role reads and changes, wrong-centre assignments, org-wide provisioning denial for centre-only staff, and CSRF rejection before session revocation. Existing source tests cover MFA/session policy, Metropolis evidence, catalogue pricing and communications governance. These tests cover source contracts; they do not amount to live browser, provider or owner acceptance. No persistent database migration or standalone `db:integration` command was run.

## 26 November 2026 functional evidence and migration qualification

S003's role catalog now makes one initial request, cancels superseded requests, ignores stale responses and exposes an accessible retry after load failure. The PATCH route remains owner/organization-authorized and continues to reject the immutable super-admin role and organization grants on centre-scoped roles. This UI correction does not establish live role assignment acceptance.

S008's price-review queue now clears the previous centre's visible records immediately on centre switch, aborts and sequence-checks pending reads, and offers retry for failed reads. If a price decision persisted but its subsequent queue reload fails, the UI says the review was recorded and asks the operator to reload before another action. The API still checks the specific price verification permission, source reference, effective dates and version; this work does not approve any real prices.

S012 consumes the consolidated `docs/SCREEN_FUNCTIONAL_EVIDENCE.json` ledger. The reconciled evidence contains **53** functional browser paths, **14** route-render-only records, **3** verified restriction records, and **108** screens with no browser evidence entry. This combines records from the Phase 01, Reception, Finance, Relationships, Communications, Marketing and Operations reports. Each claim links to an Actions run or its committed evidence record and retains its limitations. The ledger is historical and does not assert that the journeys were rerun on HEAD. Technical completion remains **0/178**, implementation-restricted remains **27**, and Owner/QA accepted remains **0/178**. No manual acceptance field or baseline was changed.

The source migration sequence from the last previously reported development baseline is:

| Migration | Purpose |
|---|---|
| 0093 | Sample receiving submission (baseline) |
| 0094 | Lead price quote drafts |
| 0095 | Collection assignment decline event |
| 0096 | Collection assignment acceptance event |
| 0097 | Website content public-slug allowlist |
| 0098 | Collection travel-started event |
| 0099 | Encrypted manual Metropolis evidence tables |
| 0100 | Encrypted communications-governance drafts |
| 0101 | Workspace read permission registry/grants |
| 0102 | Organization-scoped audit read permission registry/grants |

An isolated GitHub Actions step rehearses 0093 → 0102 in its own randomly named schema, checks migration checksums, reruns for idempotency and removes only that CI-owned schema. The initial run failed because the schema name `ci_upgrade_*` did not match the existing `p2_09a_*` allowlist enforced by encryption backfills. The qualifier now generates a unique `p2_09a_ci_upgrade_*` name and has unit coverage for that namespace; no backfill allowlist or migration permission was broadened. GitHub Actions run 201 passed the corrected rehearsal, verified all checksums, and confirmed idempotent replay applied zero migrations. It does not seed populated domain records and is not a populated-development upgrade, backup/restore, rollback, encryption-key recovery or production qualification. The persistent development database was not queried or modified in this work.

## Unresolved Phase 01–10 blockers carried forward

See [`FINAL_DEFECT_REGISTER.md`](FINAL_DEFECT_REGISTER.md) for the deduplicated blocker register, owners and closure criteria.

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

## Cross-phase verification update â€” 26 November 2026

GitHub Actions run [45767316515](https://github.com/vaishnavsawant1994-stack/Rudra-Health-Care-Centre/actions/runs/45767316515), commit `1a664c6d70f4415917b9819493116adb0edae566`, passed the migration-backed synthetic Chromium workflows. The staff login and first-login TOTP flow was exercised for the organization audit reviewer; O015's organization permission worked after migration 0102. This is synthetic session/browser evidence and does not complete S001, S003 or S012 acceptance. No protected development database was migrated.
