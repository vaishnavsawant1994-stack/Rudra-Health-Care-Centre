# P2-05 — Diagnostic Catalogue & Orders

## Status

Implemented for local development with synthetic data. PostgreSQL migrations `0012_diagnostic_catalogue.sql` and `0013_diagnostic_orders.sql` were applied to the development database and replayed against the isolated test database. The database and automated engineering checks are recorded below. Live authenticated browser acceptance and desktop/mobile visual review remain pending because the saved localhost browser permission is unavailable in this session. Application-level encryption is still outstanding. Do not enter real patient or lead information.

## Screens and connected workflows

- `/catalogue/tests` and `/catalogue/packages` provide centre-scoped directories, search, verification state and inline catalogue administration.
- `/catalogue/[id]` shows current catalogue details, package components and immutable version history; authorized staff can create a new version without altering old orders.
- `/catalogue/import` accepts CSV and single-sheet `.xlsx` workbooks. Workbook parsing runs in the browser; formulas, multi-sheet books, files over 1 MB, more than 1,000 data rows or more than 20 columns are rejected. Staff review a digest-bound preview before import. Imported prices stay unverified.
- `/catalogue/prices` shows candidate prices for authorized source review, effective dates, reviewer and reason.
- `/orders` provides order status counts and a dashboard view; `/orders/directory` provides status and centre filters.
- `/orders/new` creates an order from a scheduled appointment or an existing patient selected through the authorized patient-search workflow.
- `/orders/[id]` displays the service snapshots and status history. Draft services can be replaced; removed draft items remain in history. Confirmation is available only when every selected version is current and source-verified within its effective period. Cancellation retains the order and snapshots.
- Patient 360° shows order history where `orders.read` is granted and links to order creation. Appointment details link to order creation without putting patient or appointment identifiers in the URL.

Catalogue and order navigation is permission-filtered. Every API independently checks the staff session, MFA state, centre scope and operation permission.

## Catalogue rules

- Catalogue items have stable codes and versioned details for tests and packages, specimen requirements, preparation instructions, optional Metropolis reference codes, active state and optional INR candidate amounts.
- New manual records begin `UNVERIFIED`. Explicit synthetic development references are labelled `SYNTHETIC` and cannot carry a price. Inactive items remain visible only when the authorized filter includes them.
- Package versions reference test versions within the same organization and centre. The API and database reject wrong service types, missing references, duplicate components and cross-centre links.
- Price decisions are append-only with reviewer, source reference, effective period and reason. The approved amount is the entered source amount; the application does not calculate a markup. No current Metropolis source data was supplied or externally verified in this milestone.
- Catalogue changes create new versions and do not rewrite order snapshots.

## Order rules and boundaries

- Orders are centre- and organization-scoped, patient-linked, and optionally linked to one appointment. A transaction and idempotency key prevent duplicate submissions; one appointment can have one diagnostic order.
- Service selections snapshot the catalogue version, display details, package components, verification state and verified price evidence. An unverified or expired candidate never becomes an order charge.
- Selecting both a package and one of its component tests is rejected. Multiple disjoint tests/packages may be selected in one order.
- Draft and pending-verification items can be replaced through audited soft removal. Confirmed and cancelled items are database-protected from mutation. Order status history is append-only and stale updates require refresh.
- Order confirmation snapshots only verified, current, effective prices. Cancellation requires a reason and retains status and item history.
- P2-05 records diagnostic order intake only. It does not create a Metropolis laboratory order or mark a sample collected, dispatched, received, processing, reported or delivered. No invoices, payments, communications, real-time availability or collection capacity are implemented here.

## Database and APIs

- Migration 0012 adds catalogue import batches, catalogue items and immutable versions, package components, price-review history and catalogue permissions. Database triggers protect version history and review/import records; organization/centre foreign keys enforce tenant and centre scope.
- Migration 0013 adds diagnostic orders, service snapshots, status history, idempotency constraints, appointment uniqueness, and order permissions. Database protections retain removed draft items, prevent edits after confirmation, append-only status history, and disallow destructive deletes for the runtime application role.
- Catalogue APIs: `GET/POST /api/catalogue`, `GET /api/catalogue/centres`, `POST /api/catalogue/import`, `GET/PATCH /api/catalogue/[id]`, `POST /api/catalogue/[id]/verify`.
- Order APIs: `GET/POST /api/orders`, `GET/PATCH /api/orders/[id]`, `GET /api/orders/centres`, `POST /api/orders/patient-history`.
- Patient identifiers and search terms are sent in POST bodies for patient lookup/history. Audit details exclude patient names, phone, email, medical information and raw import contents. Import audit records use a content digest.
- The future Metropolis connection is represented by a manual-first boundary only; no external API call or credential is configured.

## Verification

Qualification run completed 2026-10-29:

- Clean dependency install and lockfile verification: `npm ci` passed; no lockfile mismatch. The package audit reported 0 vulnerabilities.
- Lint: passed (`npm.cmd run lint`). TypeScript: passed (`npm.cmd run typecheck`).
- Unit/API tests: passed, 79 tests across 25 files (`npm.cmd test`).
- Production build: passed (`npm.cmd run build`). The first run exposed Next.js 16 Cache Components incompatibility with `dynamic = "force-dynamic"` on the catalogue and order detail pages. Those exports were removed and `instant = false` was added to preserve blocking, request-time rendering; the final build completed and included both detail routes.
- PostgreSQL migrations: passed; `npm.cmd run db:migrate` found 13 total and applied 0 new migrations. Integration verification replayed all 13 migrations and passed the catalogue/order constraints, history, source review, immutability, centre isolation and runtime-role checks.
- Runtime-role privilege checks: passed; expected catalogue/order operations and append-only history grants were present, with destructive delete privileges absent.
- Audit chain: passed; 1 event verified (`npm.cmd run db:verify-audit`).
- Dependency audit: passed; 0 vulnerabilities (`npm.cmd audit -- --audit-level=low`).
- Desktop/mobile browser acceptance and live authenticated/unauthorized HTTP workflows: not run. Saved localhost browser permission remains unavailable; no alternate access path was used.
- `git diff --check` could not run because this project directory is not inside a Git working tree.

All database test fixtures use synthetic records inside a transaction and are rolled back. Route authorization tests mock the auth boundary; they are not a substitute for live HTTP authorization attempts.

## Limitations and remaining acceptance gates

- No approved current Metropolis catalogue file was provided. A staff reviewer can record source details, but the system cannot independently establish that those details match Metropolis until real source material and the approved review process are configured.
- No Metropolis API, lab order creation, real availability, sample lifecycle, billing, reports or customer notifications were connected.
- Application-level encryption is not implemented. Use synthetic development records only.
- Direct live unauthorized HTTP attempts, authenticated owner/staff workflows and desktop/mobile visual review remain pending; the saved browser permission blocked localhost use, and no alternate access path was attempted.
- This milestone is not production qualification and does not authorize production deployment or real patient data.

## Next milestone

P2-06 — Home Collection & Sample Lifecycle is planned only. Keep appointment scheduling, diagnostic order intake, collection, Metropolis handoff, reports and billing as separate audited operations.
