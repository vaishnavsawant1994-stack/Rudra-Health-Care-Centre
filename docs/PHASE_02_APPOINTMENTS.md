# P2-04 — Appointments & Booking Management

## Status

Implemented for local development with synthetic data. The PostgreSQL migration was applied to the development database and replayed on the isolated test database. Live authenticated browser acceptance and responsive visual review remain unverified because the saved browser permission denied access to `localhost:3000` during this turn. Do not use real patient information; application-level encryption remains outstanding.

## Screens

- `/appointments` — centre-scoped overview, today's status totals, seven-day count, searchable/paginated directory and filters.
- `/appointments/new` — create centre or home-collection booking request for an existing patient; select requested services, optional staff and local centre time. Patient registration remains available through the Patient workflow, then staff return to booking and select that patient.
- `/appointments/[id]` — patient and centre details, requested service references, appointment and assignment timelines, operational contact-permission evidence, reschedule, assignment, status and cancellation actions.
- `/appointments/calendar` — daily, weekly and calendar-month range views in the selected centre timezone. It shows recorded requests and does not imply open slots.
- `/appointments/team` — authorized centre's daily staff schedule.
- `/appointments/home-collection` — home-collection bookings and the separately recorded service charge.

The existing Patient 360° screen links to booking when the signed-in staff has booking permission. A converted CRM lead links to booking only when its patient conversion is verified and patient-read access exists. A family relationship does not grant booking or health-record access; the appointment screen shows a linked family label only if the staff member separately has family-read permission.

## Backend and database

- Migration `0011_appointments_booking.sql` adds appointments, pending service-reference rows, append-only status/reschedule history and append-only staff-assignment history. Earlier migrations are unchanged.
- APIs: `GET/POST /api/appointments`, `POST /api/appointments/search`, `GET/PATCH /api/appointments/[id]`, and centre, assignee, summary, team and calendar read endpoints.
- Every write requires the existing same-origin/MFA-authenticated staff session and server-side permission checks. Centre scope and patient-centre linkage are checked in service queries and foreign keys. Assigned-only staff can read only bookings assigned to their own staff account.
- Creation uses an idempotency key and stable request hash. Staff conflict checks run under a PostgreSQL advisory transaction lock. Updates use a locked row plus `expectedUpdatedAt`; stale concurrent updates return a refresh-required conflict.
- Status and assignment events are append-only at the database layer. Cancellation and rescheduling preserve history and require a reason.
- Operational contact permission is separate from marketing consent. Authorization/withdrawal requires an evidence reference; no outbound message is sent.
- Home-visit charges are separate from diagnostic service pricing. The supported options are ₹0, ₹75, ₹99, ₹150, custom and waived. Custom/waived require an authorized permission and recorded reason. No invoice or payment is created.
- Appointment services have no price field and start `PENDING` verification. There is no verified Rudra/Metropolis catalogue or capacity data in this milestone, so live price, eligibility, availability and open slots are not shown or inferred.

## Verification performed

- `npm.cmd run db:migrate` — passed; 0011 applied, 11 migrations total. A second execution applied 0 new migrations.
- `npm.cmd run db:integration` — passed; all 11 migrations replayed on the isolated test database; synthetic appointment and home-charge persistence, service pending state, cross-centre patient association rejection and append-only history were verified. The runtime-role check verified appointment read/create/update, service insert and history append grants, with appointment deletion and history mutation denied.
- `npm.cmd test` — passed, 65 tests across 21 files, including appointment policy and route-handler authentication/CSRF tests.
- `npm.cmd run typecheck` — passed after fixes.
- `npm.cmd run lint` — passed with 0 errors and 0 warnings.
- `npm.cmd audit -- --audit-level=low` — passed; 0 vulnerabilities.
- `npm.cmd run db:verify-audit` — passed; local audit chain verified (1 event).
- `npm.cmd run build` — passed after adding the required Next.js dynamic-route configuration for appointment detail and new booking pages.
- Browser check — not completed. The browser connector rejected local page access because a saved permission setting blocks `http://localhost:3000`. No alternate path was used. Route-handler tests cover unauthenticated (401), MFA-incomplete (428) and cross-origin (403) rejection, but those are mocked handler tests, not live HTTP verification. Cross-centre integrity was tested in PostgreSQL.

## Limitations and pending acceptance

- Home address and other application data are not application-level encrypted. Synthetic data only.
- No approved service catalogue, Metropolis API, capacity calendar or verified availability integration exists yet. Service requests remain pending verification; requested time is not confirmed capacity.
- No actual sample collection, lab processing, report delivery, billing, invoicing, payment, SMS, WhatsApp, email or AI contact operation is implemented here.
- The booking form links to the separate patient-registration workflow; it does not create a new patient inline.
- Direct unauthenticated HTTP requests against a running server and live authenticated owner/staff workflows were not exercised in a browser. Desktop/mobile visual review is pending due the saved local browser restriction.
- This milestone is not a production-security qualification and does not authorize real patient data.

## Next milestone

P2-05 should define the order and sample-collection workflow separately from appointment booking, including manual-first Metropolis references and event verification. Do not mark collection, dispatch, lab receipt or report delivery as complete until a real authorized event is recorded.
