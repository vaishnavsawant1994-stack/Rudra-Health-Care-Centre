# Rudra Health Care Centre — Rudra Health OS R1

Rudra Health OS R1 engineering foundation. Rudra owns customer relationships and operational records; Metropolis remains behind a manual integration boundary until an approved workflow or API is available.

## Current contents

- `dist/index.html`: responsive staff-shell prototype using synthetic records. Demo sign-in is not authentication.
- `prototype/catalogue-foundation.html`: static R1.2 catalogue screen scaffold with disabled actions and no connected records.
- `prototype/r1-3-appointments-orders.html`: static appointment and service-order screen scaffold with no connected records.
- `backend/`: Node.js service, OIDC identity-provider boundary, opaque sessions, server-side authorization, patient/family/lead/appointment/order APIs, encrypted contact/address fields, append-only consent/audit history, and migrations 001–013.
- R1.2: doctor, corporate, partner, and diagnostic test/package catalogue APIs and schema, with organization/centre boundary coverage.
- R1.3: appointment scheduling and service-order lifecycle APIs, scoped roles, price snapshots, and integration coverage. Metropolis operations remain manual.
- `.github/workflows/backend-quality.yml`: PostgreSQL-backed qualification workflow. It applies migrations to clean PostgreSQL 16, checks replay and rollback behavior, runs lint, unit and database integration tests, scans for secrets, and checks dependency advisories.

## Qualification record

R1.1–R1.3 are qualified for engineering/internal development only. R1.3 passed on PR #5 head `930b6c5bda925c3edef560124adf07a247f29061` (merge `f69755d0a60fdc34fbaa171fcef6388a9580f1f2`), with PostgreSQL 16 migrations, integration tests, lint, secret scanning, and dependency audit passing in CI.

## Safety and status

This remains an engineering implementation, not an operational diagnostic system. Do not enter real patient or staff data. No production identity-provider tenant, database, managed key store, hosting environment, report storage, or Metropolis connectivity is configured. Patient use remains prohibited until the exact release is qualified and the applicable privacy, franchise, and operational controls are approved.

See `backend/README.md` for routes, setup, security boundaries, and qualification requirements. Use synthetic data only.
