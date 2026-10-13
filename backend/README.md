# Rudra Health OS R1 backend

This is the first executable backend slice for R1.1: an OIDC identity-provider boundary, opaque staff sessions, server-side permission and centre-scope checks, patient/family APIs, lead pipeline APIs, encrypted contact fields, and append-only audit writes. The service is a modular Node.js application backed by PostgreSQL; it is not split into microservices.

## Current implementation boundary

- Staff passwords and MFA credentials stay with the selected OIDC provider. Rudra validates ID tokens against the provider's discovery document/JWKS and never accepts a client-supplied identity.
- Rudra creates HttpOnly, SameSite cookies with opaque, hashed, rotating sessions. Sessions have an eight-hour idle expiry and a twelve-hour absolute limit. Unsafe browser requests require a CSRF token.
- MFA is provider-enforced: when a staff account has `mfa_enabled`, the signed OIDC claims must prove an approved `amr` value or configured `acr` value.
- Roles and permissions are checked in the API on every request. Centre-limited roles are constrained by `user_roles.centre_id`; UI visibility is not an authorization control.
- Mobile numbers, email addresses, and external provider identifiers are encrypted with AES-256-GCM and use keyed HMAC lookup hashes. Set the key variables from a managed secret store and plan rotation before production.
- Patient duplicate checks use the keyed mobile lookup. Staff must review a `409 POSSIBLE_DUPLICATE`; this service never silently merges people.
- Every patient/lead mutation and authentication lifecycle action writes an audit event in the same transaction where possible. Database triggers prevent ordinary updates/deletes to audit and consent history.
- The Metropolis boundary remains a manual external-reference record. This tranche does not create Metropolis orders, synchronize statuses, retrieve reports, or import settlements.

## Routes in this tranche

| Area | Implemented routes |
|---|---|
| Identity | `GET /api/v1/auth/login`, `GET /api/v1/auth/callback`, `GET /api/v1/auth/me`, `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:sessionId`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout` |
| Patients | `GET/POST /api/v1/patients`, `GET/PATCH /api/v1/patients/:id`, `GET /api/v1/patients/:id/timeline`, `GET/POST /api/v1/patients/:id/addresses`, `GET/POST /api/v1/patients/:id/family`, `DELETE /api/v1/patients/:id/family/:relationshipId`, `GET/POST /api/v1/patients/:id/external-identifiers`, `PATCH /api/v1/patients/:id/external-identifiers/:externalId` |
| Leads | `GET/POST /api/v1/leads`, `GET/PATCH /api/v1/leads/:id`, `POST /api/v1/leads/:id/activities`, `POST /api/v1/leads/:id/convert`, `POST /api/v1/leads/:id/lost` |
| Relationships | `GET/POST /api/v1/doctors`, `GET/PATCH /api/v1/doctors/:id`; corresponding routes for `/corporates` and `/partners` |
| Catalogue | `GET/POST /api/v1/catalogue/tests`, `GET/PATCH /api/v1/catalogue/tests/:id`; matching routes for `/catalogue/packages` with centre-consistent test items |
| Appointments | `GET/POST /api/v1/appointments`, `GET/PATCH /api/v1/appointments/:id`, `POST /api/v1/appointments/:id/status` |
| Service orders | `GET/POST /api/v1/service-orders`, `GET/PATCH /api/v1/service-orders/:id`, `POST /api/v1/service-orders/:id/status` |
| Operations | `GET /health/live`, `GET /health/ready` |

Responses use `{ "data": ..., "meta": ... }`; errors use `{ "error": { "code", "message", "requestId" } }`. All database queries are parameterized and organization-scoped.

## Local checks

Requirements: Node.js 22+, PostgreSQL 15+.

```sh
cd backend
npm install
npm run lint
npm test
cp .env.example .env
# Fill DATABASE_URL, RUDRA_ORGANIZATION_ID, OIDC settings, and three distinct 32-byte base64 keys.
node src/migrate.mjs
npm start
```

CI runs lint without automatic fixes. Type-checking is not applicable to this plain JavaScript `.mjs` project, and a separate build step is not applicable because Node runs the source directly without transpilation or bundling.

R1.1 and R1.2 are qualified for engineering/internal development only. R1.3 appointments and service orders are under qualification on the active feature branch; do not treat them as qualified until the exact PR head passes CI.

The static screen scaffold lives at `prototype/catalogue-foundation.html`. It is not connected to this API and does not authenticate users or contain catalogue records.

The R1.3 screen scaffold lives at `prototype/r1-3-appointments-orders.html`. It is not connected to this API. Appointment states are `SCHEDULED → CONFIRMED → CHECKED_IN → IN_SERVICE → COMPLETED`, with cancellation or no-show only before check-in. Orders progress from `BOOKED` to sample collection and processing, then partial or full completion; invalid transitions are rejected. Metropolis order entry and report retrieval remain manual and outside this tranche.

The migration runner applies each migration transactionally, serializes migration processes with a PostgreSQL advisory lock, records checksums, and refuses to silently accept a changed applied migration. Use a clean non-production database to qualify the migrations before any deployment.

## Provisioning and current limitations

1. Create the Rudra organization and at least one centre using approved legal/business details. No fictitious centre or patient seed data is included.
2. Configure the selected OIDC application with the exact callback URI from `OIDC_REDIRECT_URI`; disable public sign-up and restrict staff provisioning to Rudra administrators.
3. Create an `users` row with the identity provider's stable `sub`, then assign a role and centre in `user_roles`. The first owner assignment must be done through a controlled database/bootstrap process.
4. Set separate random keys for cookie signing, field encryption, and lookup HMAC. Keep them outside source control, back them up under a key-management policy, and do not reuse them across environments.
5. Exercise sign-in, MFA enforcement, session rotation/revocation, centre-isolation tests, database restore, and security review in staging before using actual staff or patient records.

No Rudra database, identity-provider tenant, managed key store, production host, or credentials were supplied. Migrations have not been applied to a live database. This implementation is an engineering tranche and must use synthetic data until full qualification and the applicable privacy/franchise controls are completed. Do not enter real patient data yet.
