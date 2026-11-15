# Rudra Health Care Centre — GitHub R1 Engineering — Project Handbook

> Owner: `vaishnavsawant1994-stack` · Repository: `Rudra-Health-Care-Centre` · Reviewed: 15 November 2026  
> Documentation maturity: repo/source/manifest inspection; **not** an independent live release certification.

## Project overview and audience
Diagnostics-related CRM and center operations engineering tranche, keeping external Metropolis activities behind a manual integration boundary.

**Intended users:** Rudra developers and authorized healthcare operations reviewers.

## Main features / user journeys
1. Patient/family and lead management API foundations.
2. Doctor, corporate, partner and diagnostic catalogue endpoints.
3. Appointment and service-order state transitions.
4. OIDC boundary, scoped sessions, encrypted contacts and append-only audit records.

These items are code areas and project goals; individual end-to-end flows must be qualified separately.

## Architecture, stack and repository layout
Node.js backend in `backend/`, PostgreSQL migrations 001–013, plain `.mjs` modules, tests; static prototype HTML under `prototype/` and staff-shell demo. The UI prototypes are **not** wired as operational clinical systems.

## What is actually qualified or still outstanding
Repository README certifies historical R1.1–R1.3 engineering/internal qualification only. Separate local Rudra work through later phases cannot be considered pushed to this GitHub repo without a verified commit comparison.

Source code and historical QA reports are distinct from passing current CI, real integrations, live deployment and production acceptance.

## Installation and developer operations
From `backend/`: install Node 22+ deps, configure throwaway PostgreSQL 15+/OIDC test provider and encryption keys, `npm run lint`, `npm test`, run migration tool only on disposable DB, `npm start`.

Before running migrations, scripts or providers, verify environment, branches, private credentials, target database and rollback. Do not use actual user/customer records in unqualified development.

## Security and quality requirements
- Never enter real patient/staff data until full privacy/franchise/release approval.
- Treat integration with Metropolis as manual until contract and API access are approved.
- OIDC and admin bootstrap must be tested with actual key/session isolation.
Release acceptance also requires role/session auditing, dependency/security review, accessible interaction, observability, backups, restore and a controlled rollback where applicable.

## Prioritized roadmap
1. Reconcile local 11-phase workspace with GitHub source without overwriting uncommitted work.
2. Document screen/API/DB evidence matrix for each phase.
3. Qualify external diagnostic workflows and staff authorizations.
4. Perform staging privacy, restore, security and production-readiness review.

## Source-of-truth documents
- [`README.md`](../README.md)
- [`backend/README.md`](../backend/README.md)
- [`backend/migrations/`](../backend/migrations/)
- [`prototype/`](../prototype/)
- [`.github/workflows/backend-quality.yml`](../.github/workflows/backend-quality.yml)

**Maintenance:** Revisit this guide when functional implementation, project boundaries or deployment gates change. For precise status, read qualified exact-commit test and release artifacts.
