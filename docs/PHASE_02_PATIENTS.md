# Phase 02 — Patient & Family 360°

## P2-01 — Patient registration and Patient 360°

Status: **implemented; automated checks passed; authenticated visual/browser acceptance pending**.

### Implemented

- Versioned PostgreSQL migration for patient and patient-relationship records, centre/organization foreign keys, consent status, indexes and patient permissions.
- Role grants for Owner, Administrator, Centre Manager and Receptionist; Customer Support and Sales/Marketing do not receive patient permissions.
- Protected APIs for authorized-centre list/search, centre choices, registration, profile reads and edits.
- UUID internal IDs plus unique Rudra patient numbers.
- Exact phone/email duplicate warning within a centre. The response does not disclose the existing patient's identity.
- Patient profile includes demographics, contact details, address, consent record, confirmed family links that the current operator is separately authorized to view, and an activity timeline derived from audit metadata.
- Create/update actions are same-origin protected and append hash-chained audit events containing operation/field metadata, not patient values.
- Responsive patient list, registration, detail and edit screens with loading, empty, validation, unauthorized, service-error and success states.
- Synthetic unit/API tests and PostgreSQL integration checks cover input policy, consent validation, center scoping, unauthenticated list/create rejection, cross-centre denial, database persistence, cross-organization centre rejection, duplicate patient-number constraint, runtime-role grants and audit behavior.

### Routes and implementation files

- Screens: `/patients`, `/patients/new`, `/patients/[id]`, `/patients/[id]/edit`.
- APIs: `GET/POST /api/patients`, `POST /api/patients/search`, `GET /api/patients/centres`, `GET/PATCH /api/patients/[id]`.
- Schema/migrations: `src/db/schema.ts`, `drizzle/migrations/0004_patient_registration.sql`, and `drizzle/migrations/0005_limit_patient_read_grants.sql`.
- Authorization/validation: `src/server/patient-policy.ts`, `src/server/patient-search.ts`, and the existing authenticated access and audit services.
- UI: `src/components/patients/patient-workbench.tsx` plus the four route pages and responsive rules in `src/app/globals.css`.
- Tests: patient policy tests, patient API authorization tests, and synthetic PostgreSQL coverage in `scripts/db-integration-check.mjs`.

Family integration was added in P2-02: Patient 360° displays authorized family membership, and family records/grants remain independently permissioned. See `PHASE_02_FAMILIES.md`. Family membership never grants access to a patient's clinical record.

### Verification record (2026-10-28)

| Check | Result |
| --- | --- |
| Lint | Passed |
| TypeScript | Passed |
| Unit/API tests | 40 tests across 14 files passed |
| Development migrations | 5 total applied; replay applies 0 new migrations |
| PostgreSQL integration | Passed on isolated test DB; synthetic patient persisted/read; cross-organization centre and duplicate patient-number constraints rejected; 5 migrations replayed |
| Runtime application role | Passed; patient read/create/update, relationship read and audit append grants verified against development DB |
| Audit chain | Passed; 1 event verified |
| Dependency audit | 0 vulnerabilities |
| Lockfile check | Passed |
| Production build | Passed; 38 routes compiled/generated |
| Authenticated browser / desktop-mobile view | Pending; prior saved browser restriction was not bypassed |

## Milestone decision

P2-01 is **implemented and verified for continued local development with synthetic data**. API-level automated tests verify unauthenticated list/search/create denial and cross-centre list denial before any patient-table query. PostgreSQL test records were inserted only in a transaction and rolled back. This does not close the separate Phase 01 browser acceptance gates or qualify this application for real patient records or production use. Proceed next to P2-02 family-link creation and explicit sharing authorization; keep the pending browser/visual checks visible.

### Limits and privacy notes

- Family relationship display is read-only in this milestone. There is no family-link creation, adult authorization, sharing-grant or Family 360° workflow yet. A relationship alone never grants access.
- Duplicate checks are exact-match and centre-local; cross-centre possible duplicates need a separately authorized resolution workflow.
- Search is capped at 50 and query values are not logged, but database PII is currently stored in ordinary PostgreSQL columns. Application-level encryption, managed key rotation, production rate limiting/monitoring, retention policy, privacy/legal review, backup/restore and production controls remain prerequisites before real patient information.
- Consent records status and method only. It does not define the legal basis, approved consent wording or policy for declining consent.
- Patient deletion is intentionally not implemented; corrections are auditable updates.
- The existing Phase 01 unauthorized-browser and desktop/mobile visual checks remain pending acceptance gates. No browser permission was bypassed.

## Next milestone — P2-02 Family linkage and Family 360°

Implement verified patient-to-patient relationship requests, identity/guardian confirmation, explicit purpose-bound sharing permissions, revocation and expiry, adult confidentiality defaults, Family 360° display, and tests proving a family link alone cannot read another patient's record. Include centre/organization authorization for both linked records and audit each grant/revocation.

No real patient data or production deployment is authorized by this development milestone.
