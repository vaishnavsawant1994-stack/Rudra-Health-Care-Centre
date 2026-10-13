# Rudra Health Care Centre — Rudra Health OS R1

Rudra Health OS R1 engineering foundation. Rudra owns customer relationships and operational records; Metropolis remains behind a manual integration boundary until an approved workflow or API is available.

## Current contents

- `dist/index.html`: responsive staff-shell prototype using synthetic records. Demo sign-in is not authentication.
- `backend/`: Node.js service, OIDC identity-provider boundary, opaque sessions, server-side authorization, patient/family/lead APIs, encrypted contact/address fields, append-only consent/audit history, and PostgreSQL migrations 001–007.
- `.github/workflows/backend-quality.yml`: PostgreSQL-backed qualification workflow. It applies migrations to a clean PostgreSQL 16 service, checks migration replay, runs unit and database integration tests, scans for secrets, and checks dependency advisories.

## Safety and status

This remains an engineering implementation, not an operational diagnostic system. Do not enter real patient or staff data. No production identity-provider tenant, database, managed key store, hosting environment, report storage, or Metropolis connectivity is configured. Patient use remains prohibited until the exact release is qualified and the applicable privacy, franchise, and operational controls are approved.

See `backend/README.md` for routes, setup, security boundaries, and qualification requirements. Use synthetic data only.
