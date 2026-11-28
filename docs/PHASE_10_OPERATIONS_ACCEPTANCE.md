# Phase 10 — Owner, Operations, Quality & Analytics

**Checkpoint:** 14 November 2026  
**Scope:** O001–O016, preserving canonical IDs and routes in `SCREEN_SPEC_178.md`.  
**Status:** Development checkpoint only. No screen has final desktop/mobile or manual acceptance.

## Evidence and constraints

The Phase 10 route layer provides exact canonical routes and reuses existing server-authorized APIs and workbenches where those contracts exist. A route or dashboard is not proof that all proposed controls are implemented. Existing permissions remain enforced by `AdminShell` and the APIs; wrappers do not grant access to records.

The current source schema contains centre profiles, tasks/events, escalations, staff shifts and assignment history, authorized audit events, lead/conversion records, appointment and collection queues, and finance records. It does not contain authoritative inventory/stock movement, procurement, quality incident/CAPA, SOP/training, centre capacity/service-area, or operational SLA policy records. Those functions stay restricted. No synthetic operational counts or realistic demo transactions were added.

The development database must remain at migration 0093; source migrations 0094–0100 are not applied. No migration, database write, provider activation, external communication, production data access, deployment, commit or push was performed for this checkpoint.

## Screen status

| ID | Canonical screen / route | Implementation evidence | Backend and authorization evidence | Limitation / blocker | Acceptance |
|---|---|---|---|---|---|
| O001 | Owner Command Centre `/owner` | Existing owner dashboard and permission-filtered operational panels | `organization.read`; owner panels render only for grants, with centre-scoped module APIs | Combined data is not an all-module reconciliation | Pending |
| O002 | Centre Manager Dashboard `/manage` | New dashboard composes centre queue summary, roster, and task workbenches | `workspace.read`; existing APIs apply module-specific centre/role checks | No financial/clinical overview beyond grants; unavailable permissions are not shown as zero | Pending |
| O003 | Multi-Centre Directory & Settings `/manage/centres` | New canonical route reuses centre directory, public-profile workflow and authorized create form | `centres.read` / `centres.manage`; centre API checks organization and scope | Operational policy overrides and capacity settings are unsupported | Pending |
| O004 | Service Area & Capacity Manager `/manage/capacity` | Authenticated restricted-state screen | Requires centre read access; no availability API is invoked | No authoritative service-area/capacity model or publishing lifecycle | Pending |
| O005 | Staffing, Rostering & Work Allocation `/manage/roster` | Canonical route reuses roster workbench; browser journey creates a synthetic planned shift and checks persisted status/version | Roster API and existing assignment/shift permissions; scoped workload and history; synthetic Chromium path passed in run 45767316515 | Staffing sufficiency, attendance, payroll and capacity feasibility are not inferred | Functional browser verification recorded; visual, accessibility and full acceptance pending |
| O006 | Rudra Action Centre `/actions` | Existing unified workbench; browser journey opens a synthetic support action in its authorized queue | Existing task, escalation and operational-queue permission checks; synthetic Chromium path passed in run 45767316515 | A displayed task does not imply source workflow completion | Functional browser verification recorded; visual, accessibility and full acceptance pending |
| O007 | Operational SLA & Escalation Policies `/manage/slas` | Authenticated restricted state; links to task-approval policy records | `tasks.policy.manage` route gate; approval policy is a distinct workflow | No SLA thresholds, centre overrides or activated automated escalation policy | Pending |
| O008 | Quality Incidents & Corrective Action `/quality/incidents` | Authenticated restricted-state screen | Support-task permission gate | No incident/investigation/CAPA schema, severity evidence or independent closure control | Pending |
| O009 | SOP Library & Staff Training `/quality/sops` | Authenticated restricted-state screen | Configuration-read route gate | No approved SOP registry, acknowledgement or training completion records | Pending |
| O010 | Inventory Dashboard & Stock Movements `/inventory` | Authenticated restricted-state screen | Configuration-read route gate | No item, batch/expiry, receipt, issue, transfer, adjustment or stock-ledger schema | Pending |
| O011 | Procurement & Reorder Approvals `/inventory/purchasing` | Authenticated restricted-state screen | Configuration-read route gate | No supplier, purchase-order, receipt/reconciliation or approval contracts | Pending |
| O012 | Complaints, Service Quality & CSAT `/quality/service` | Existing service-quality summary and support-task workbench | `tasks.support.read`; task API enforces centre and role permissions | Operational support workload, not complaint/CAPA records or CSAT surveys | Pending |
| O013 | Productivity, Route & Workforce Analysis `/analytics/operations` | New route combines existing operations analytics and roster workload | `organization.read`; underlying analytics and roster APIs filter by grants/centre | No GPS, travel estimates, quality-adjusted productivity or verified completion rate | Pending |
| O014 | Growth & Revenue Intelligence `/analytics/business` | New route shows CRM acquisition and finance workbench in separate permission-gated panels | `leads.read` and `finance.read` independently required | No external advertising spend/provider conversions; leads are not revenue or ROI | Pending |
| O015 | Audit, Compliance & Access Anomalies `/manage/audit` | Canonical route provides action/type/date filters, paging, refresh/retry and detail-on-demand; authenticated browser journey applies filters and verifies centre-scoped results | `audit.read` is organization-scoped; migration 0102 registers the database permission and grants it only to catalogued system roles; API limits queries to the reviewer organization and denies centre-only grants | No anomaly detector or controlled export workflow | Synthetic Chromium path passed in run 45767316515; visual, accessibility and Owner/QA acceptance pending |
| O016 | Business Continuity & Health Monitor `/manage/health` | New route displays system configuration readiness | `configuration.read`; existing `/api/admin/system` | Configuration readiness is not telemetry, backup completion, restore or key-recovery qualification | Pending |

## Tests and verification

- TypeScript: `npm.cmd run typecheck` passed after Phase 10 route additions; Next.js production build TypeScript also passed.
- ESLint: `npm.cmd run lint` passed after Phase 10 route additions.
- Full Vitest: **943/943 tests across 235 files passed**. The test run used `DATABASE_TEST_URL` for the dedicated local `rudra_health_test` database; PostgreSQL integration tests create disposable schemas and remove them.
- Inventory reconciliation focused suite: **15/15 passed** after updating its expectations to the generated route counts.
- Production build: `npm.cmd run build` passed; Next.js generated **393 static pages**.
- `git diff --check` reported no whitespace errors; Git printed only its existing LF-to-CRLF working-copy notices.
- `npm.cmd run db:integration` was not run: that script migrates the dedicated test database's public schema. Database integration coverage ran through disposable-schema Vitest tests instead. Persistent development DB `rudra_health_dev` remained untouched at migration 0093.
- Existing module tests provide API-level evidence for selected owner analytics, roster/task, centre admin, audit and service-quality operations. They do not cover the unavailable inventory/procurement/quality/SOP contracts and do not establish complete O-screen acceptance.
- No browser/device visual review was performed.

## Remaining blockers and next work

1. Define audited schemas, permissions, event history and approval separation for O004, O007–O011.
2. Add contract-specific service-area/capacity, SLA, incident/CAPA, SOP/training, stock-ledger and procurement tests before activating those screens.
3. Add complaint/feedback records and separate CSAT denominator/consent policy for O012.
4. Add approved, verified data sources for productivity and business attribution; keep estimates and provider data separately identified.
5. Add health telemetry, migration preflight, backup integrity, encrypted-document restore, key recovery and recovery qualification without touching the persistent database.
6. Run the full automated suite and a separate manual desktop/mobile acceptance campaign. Keep `0/16` finally accepted until those checks are evidenced.

## Phase 11 readiness

Phase 11 can proceed as a separate development wave. Security/session, consent, configuration, integrations and backup governance remain gated by outstanding operational and recovery controls. Phase 10 route coverage does not establish launch readiness.

## Current implementation checkpoint — 26 November 2026

Migration `0102_organization_audit_read_permission.sql` registers the missing organization-scoped `audit.read` database permission and grants it to the catalogued system roles. Before this migration, the authenticated synthetic reviewer correctly received HTTP 403 because the seed's role-permission join had no permission row. The isolated GitHub Actions run [45767316515](https://github.com/vaishnavsawant1994-stack/Rudra-Health-Care-Centre/actions/runs/45767316515) on commit `1a664c6d70f4415917b9819493116adb0edae566` then passed all three authenticated Chromium journeys. O005 verified a persisted synthetic planned shift, O006 opened its synthetic support action in the authorized queue, and O015 verified filtered organization audit results plus centre scoping. The same relationship journey passed the M001/M003/M005/M006/M012/M017 checks listed in the Phase 09 acceptance record. The browser run did not test an actual physical shift, attendance, payroll, external publication or patient data. Targeted local Vitest passed 31/31 across three files; targeted ESLint, TypeScript and `git diff --check` passed. GitHub quality/build/inventory and dependency-audit jobs passed; full-history secret scan remains failed on the documented historical test-fixture findings. Owner/QA, visual-reference comparison, dedicated accessibility acceptance and production qualification remain pending.
