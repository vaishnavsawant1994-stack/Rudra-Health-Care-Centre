# P2-03 — Leads & CRM Pipeline

**Status:** Implemented and verified for local development with synthetic data. This is not production qualification and does not authorize real patient or lead personal data.

## Implemented screens

- `/leads` — dashboard summary, directory, search, status/source/centre filters and pagination.
- `/leads/new` — create a centre-scoped enquiry with source, category, campaign attribution, assignee default, priority and contact preference.
- `/leads/[id]` — Lead 360° with contact/marketing permission states, status history, activity, follow-ups, assignment and conversion actions gated by server-derived capabilities.
- `/leads/[id]/edit` — update operational lead details.
- `/leads/pipeline` — status board with per-record update controls.
- `/leads/followups` — upcoming/overdue and status/centre/staff filters, reschedule, complete, unsuccessful and cancel actions.

All pages use the existing Rudra staff authentication shell. Navigation visibility is only a UI convenience; APIs independently enforce authentication, role permission, organization and centre scope.

## Database and API

Forward-only migration `0010_leads_crm.sql` adds `leads`, append-only `lead_activities`, `lead_followups`, and one-per-lead `lead_conversions`, indexes, constraints and CRM permission grants. Migrations 0001–0009 were preserved. Runtime application permissions allow the required lead operations while denying lead/follow-up deletion and activity/conversion history mutation.

APIs provide lead listing/creation/search/detail/update, centre and eligible-staff options, activity recording, follow-up creation/list/update and lead conversion. Search text is accepted in a POST body rather than a URL. Sensitive fields are omitted from audit details. Potential duplicate lead creation and patient conversion are serialized with transaction-scoped advisory locks; conversion locks the lead and commits patient creation, conversion record, status update, activity and audit together. Existing-patient conversion requires same-organization/centre identity matching and an evidence reference. It never creates family sharing.

Status transitions are validated server-side. A status change records its reason, staff actor and timestamp in activity history. Outreach and contact follow-ups require operational contact permission; marketing consent remains separate. No external messages or integrations are invoked.

## Verification results

- `npm.cmd ci` — passed; installed from the lockfile and reported 0 vulnerabilities.
- `npm.cmd ls --depth=0` — passed; top-level dependency tree is consistent.
- `npm.cmd run lint` — passed.
- `npm.cmd run typecheck` — passed.
- `npm.cmd test` — passed, 59 tests across 19 files. Includes synthetic CRM policy, unauthenticated and cross-centre search checks, and existing Phase 01/P2-01/P2-02 tests.
- `npm.cmd run db:migrate` — passed; development DB has 10 migrations applied; replay applied 0 new migrations.
- `npm.cmd run db:integration` — passed against the isolated test DB; all 10 migrations replayed and synthetic lead persistence, consent separation, follow-up completion, patient conversion, duplicate conversion rejection, tenant/centre constraints, permission registration, audit-chain integrity and append-only activity were verified. Runtime-role checks passed against the development DB, including expected lead permissions and denied deletion/history mutation.
- `npm.cmd run db:verify-audit` — passed; local development audit chain verified (1 event).
- `npm.cmd run build` — passed; Next.js compiled and generated the application and CRM pages/API routes.
- `npm.cmd audit --audit-level=low` — passed; 0 vulnerabilities reported.
- Browser visual review and real authenticated workflow acceptance — **pending**. The saved browser permission for localhost prevents accessing the local site in this session; no alternate access path was used.
- Direct live HTTP authorization attempts using real owner/staff sessions — **pending**. Route-level tests cover unauthenticated and cross-centre rejection with mocked access contexts; these are not a substitute for live acceptance.

## Known limitations and remaining gates

- Application-level encryption for patient and lead personal data is not implemented. Continue using synthetic records only.
- No public website lead intake endpoint, WhatsApp/SMS/email/AI communication, marketing campaign actions, test catalogue binding, export, or external integration is implemented. Source/campaign values are attribution fields only.
- Duplicate detection is centre-scoped and flags likely contact matches for review. It does not merge records or prove identity.
- Follow-up listing is capped at 200 records per request; lead listing is paginated to 50 records per request.
- Notes and free-text reasons are operational fields. The UI warns staff not to enter medical details, but application-level content classification/encryption is not present.
- Previously tracked direct unauthorized-API and desktop/mobile visual acceptance gates from Phase 01 remain open.
- No actual patient or lead data was used. No production deployment or P2-04 implementation was started.

## Next milestone

P2-04 — Appointments & Booking Management. Use this CRM and the existing patient/family foundation, with synthetic data until encryption and security/browser gates are separately addressed.
