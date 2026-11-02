# P2-02 — Family 360° and relationship management

Status: **implemented; local synthetic-data engineering checks passed; authenticated visual/browser acceptance pending.**

This milestone extends the existing P2-01 patient system. Family relationships are administrative associations and never grant access to another patient's health information. There is no patient/family portal access enforcement yet; the policy helper and grant lifecycle establish the boundary for a future patient-facing module.

## Implemented screens

- `/families` — authorized family directory, server-side search via POST, centre filter, member counts and primary contact summary.
- `/families/new` — create a centre-scoped family with a unique family identifier.
- `/families/[id]` — Family 360° overview, family display name, primary contact designation, member linking/new patient registration, relationship edit/verification/end, family contact arrangements and audit activity.
- `/families/[id]/sharing` — request named, information-category-specific sharing grants; review pending/active/revoked records; verify reviewed evidence or revoke.
- Patient 360° shows family memberships within the existing staff and centre authorization boundary.

All API operations are authenticated, permission-checked on the server, organization/centre scoped, same-origin checked for mutations, validated, transactional with their audit event, and return non-enumerating responses where appropriate. Search terms are submitted in a POST body, not a URL. Audit details contain operation/status identifiers and do not contain patient names, dates of birth, phone, email, evidence contents or medical information.

API surface: `GET/POST /api/families`, `POST /api/families/search`, `GET /api/families/centres`, `GET/PATCH /api/families/[id]`, `GET/POST /api/families/[id]/members`, `PATCH/DELETE /api/families/[id]/members/[memberId]`, `POST /api/families/[id]/contacts`, `PATCH/DELETE /api/families/[id]/contacts/[arrangementId]`, `GET/POST /api/families/[id]/grants`, and `PATCH/DELETE /api/families/[id]/grants/[grantId]`.

## Data and authorization

- Migrations `0006_family_management.sql` through `0009_family_runtime_privileges.sql` add families, memberships, access grants, contact arrangements and role permissions while preserving migrations `0001`–`0005`.
- Families and memberships use organization and centre foreign keys. Active/pending duplicate membership, duplicate active grant pairs and duplicate contact arrangements are constrained in PostgreSQL. Membership/grant/contact lifecycle changes lock the family record where needed to serialize against membership termination.
- Membership and sharing start pending. Verification requires an authorized staff permission plus an offline evidence reference; the interface makes clear that staff must review genuine authorization. The evidence reference is not itself proof, and the app does not infer guardianship from age or relationship.
- A sharing grant is specific to the patient, named grantee, selected data categories, purpose and time window. Revocation is an audited status transition. Relationship, primary-contact designation and family membership confer no medical-record authorization.
- Contact arrangements reference a patient's existing phone/email channel and do not copy contact values. The runtime role cannot delete family history rows.

## Verification performed

- `npm.cmd run db:migrate` — passed; 4 new migrations applied to the development database, 9 total.
- `npm.cmd run db:migrate` replay — passed; 0 new migrations applied, 9 total.
- `npm.cmd run db:integration` — passed against the isolated PostgreSQL test database; 9-migration history validated and replay stable. Synthetic checks covered family/member persistence, duplicate member rejection, cross-centre family-member rejection, pending/verified/revoked sharing and contact lifecycles, family permissions, tenant/centre constraints, audit-chain and immutability checks, session revocation, and development runtime-role grants including denied family-history deletes.
- `npm.cmd test` — passed, 47 tests across 16 files, including new family sharing policy and unauthenticated/cross-centre search API tests.
- `npm.cmd run lint` — passed.
- `npm.cmd run typecheck` — passed after the final production build generated Next route types. One overlapping check initially encountered a transient missing generated `routes.js`; it was rerun after build and passed.
- `npm.cmd run build` — passed; Next.js compiled and generated all 45 static/partial-prerendered pages and API routes.
- `npm.cmd audit --audit-level=low` — passed; 0 vulnerabilities reported.
- `npm.cmd ls --package-lock-only --depth=0` — passed; lockfile dependency tree resolved.
- `npm.cmd run db:verify-audit` — passed; configured local development audit chain verified (1 event).
- Direct browser review — blocked/pending. The browser tool rejected access to `http://localhost:3000` because a saved permission setting denies observing that origin. No alternate surface or workaround was used.

Only synthetic identities and patient/family records are used by automated checks. No real patient data was entered.

## Remaining limits and acceptance gates

- Owner/staff authenticated desktop and mobile visual review is pending; no localhost browser permission was bypassed.
- Direct manual browser acceptance of create/link/edit/end and grant/revoke workflows remains pending.
- Route authorization unit tests use mocked identity/access results. A direct live HTTP attack attempt against a signed-in server was not performed; the prior Phase 01 direct unauthorized API acceptance gate remains pending.
- No patient login or patient portal exists, so the new grant policy is not yet a complete patient-facing access-control feature. Do not expose patient data through a portal until that integration has an independently tested authorization decision.
- Offline evidence references support auditability but are not identity document storage or independent verification. A future production workflow needs an approved evidence process.
- Application-level encryption for patient and family personal data is not implemented. Keep using synthetic data only.
- The previously tracked Phase 01 unauthorized API and visual acceptance gates remain open. This milestone does not constitute production security qualification or authorize deployment.

## Next milestone

P2-03 — Leads & CRM Pipeline. Keep P2-02 family scope limited to linking, explicit sharing authorization records and contact arrangements; do not implement appointments, orders, communications or family booking in this milestone.
