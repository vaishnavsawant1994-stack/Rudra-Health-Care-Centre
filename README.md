# Rudra Health Care Centre — Rudra Health OS R1

Rudra Health OS R1 engineering foundation. Rudra owns customer relationships and operational records; Metropolis remains behind a manual integration boundary until an approved workflow or API is available.

## Current contents

- `dist/index.html`: responsive staff-shell prototype using synthetic records. Demo sign-in is not authentication.
- `backend/`: Node.js service, OIDC identity-provider boundary, opaque sessions, server-side authorization, patient/family/lead APIs, encrypted contact/address fields, append-only consent/audit history, and migrations 001–011.
- R1.2 branch: doctor, corporate, partner, and diagnostic test/package catalogue APIs and schema, with organization/centre boundary coverage. This tranche is in progress and not yet qualified.
- `.github/workflows/backend-quality.yml`: PostgreSQL-backed qualification workflow. It applies migrations to clean PostgreSQL 16, checks replay and rollback behavior, runs lint, unit and database integration tests, scans for secrets, and checks dependency advisories.

## Qualification record

R1.1 backend foundation is qualified for engineering/internal development on exact PR head `f7a493d8cea073dca7f0b9050722596797d36be0` (PR #2; merge `3da817dcb807d0e91a4c6169a3482e780de7b547`). R1.2 must pass the same exact-SHA gates before it is considered qualified.

## Safety and status

This remains an engineering implementation, not an operational diagnostic system. Do not enter real patient or staff data. No production identity-provider tenant, database, managed key store, hosting environment, report storage, or Metropolis connectivity is configured. Patient use remains prohibited until the exact release is qualified and the applicable privacy, franchise, and operational controls are approved.

See `backend/README.md` for routes, setup, security boundaries, and qualification requirements. Use synthetic data only.
