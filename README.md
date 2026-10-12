# Rudra Health Care Centre

Rudra Health OS R1 foundation repository. Rudra owns the customer relationship and internal operational records; Metropolis remains behind a manual placeholder adapter until an approved workflow/API is provided.

## Current contents

- `web/index.html`: responsive Screen 01 staff login and application-shell prototype. Synthetic data only; demo sign-in is not authentication.
- `backend/migrations/001_organization_centres.sql` through `004_leads_consents_audit.sql`: initial PostgreSQL 15+ migration foundation.
- `backend/README.md`: migration and security status.

## Safety and status

This repository is an engineering starter, not an operational diagnostic system. No real patient or staff data should be entered. Authentication, service APIs, production database, report storage, and Metropolis connectivity are not implemented. Do not deploy for patient use until authorization, privacy, security, backup/restore, and operational gates pass.

## Next build slice

Implement the identity-provider boundary and server-side authorization tests, then add patient/family/lead APIs backed by the first migrations. Use synthetic data in development and qualification.
