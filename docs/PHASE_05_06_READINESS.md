# Phase 05 stabilization and migration readiness

**Checked:** 14 November 2026 (Asia/Kolkata). **Method:** metadata queries in explicit read-only transactions, source inspection, and disposable PostgreSQL schema tests. **Data:** synthetic test fixtures only.

## Existing local database

Both configured local application and migration targets resolve to loopback PostgreSQL 17.11 database `rudra_health_dev`; the connected roles are `rudra_dev_app` and `rudra_dev_migrator`. The application role is not superuser and cannot create databases or roles. The migration role also lacks those cluster-level privileges. The existing schema ledger has 93 entries through `0093_sample_receiving_submission.sql`; there are no checksum mismatches or unknown ledger entries. The six absent migrations are 0094–0099. Queries used `BEGIN READ ONLY` and were rolled back; the persistent database was not changed.

The application role has finance payment SELECT/INSERT/UPDATE and no DELETE; this metadata check does not establish whether every UPDATE is necessary or whether row-level policies are effective. `finance_payments` exists; `lead_quotes` and the new Metropolis tables do not exist in this database. `pg_stat_archiver` reports 0 archived and 0 failed WAL segments and no last archive time. This does not prove backups are absent, but it provides no evidence of a qualified backup. `docs/LOCAL_KEY_RECOVERY.md` documents key recovery, not a complete database-and-private-document backup/restore drill. Migration readiness is **not qualified**. Do not migrate this database until an independently verified backup, restore rehearsal, schema/data preflight, approved maintenance window and rollback plan are recorded.

## Pending migration review

| Migration | Reviewed effect | Preflight / operational risk |
|---|---|---|
| 0094 lead price quote drafts | Adds append-only encrypted internal quote snapshot table and grants app SELECT/INSERT. | Additive DDL; requires referenced lead/staff rows and current roles. External quote delivery remains disabled. |
| 0095 collection assignment decline | Replaces event-type check constraint to allow `ASSIGNMENT_DECLINED`. | Existing rows with unlisted event values make constraint creation fail; table lock during DDL. |
| 0096 collection assignment acceptance | Replaces the same constraint to allow `ASSIGNMENT_ACCEPTED`. | Same data scan/lock and unknown-event preflight as 0095. |
| 0097 website public slug allowlist | Replaces slug check with an explicit allowlist. | Existing slug values outside the new list make migration fail; inspect rows before applying. |
| 0098 collection travel started | Replaces collection event constraint to allow `TRAVEL_STARTED`. | Same data scan/lock and unknown-event preflight; legacy values are retained in the check. |
| 0099 Metropolis manual evidence | Adds encrypted reference mappings, manual status events, independent review and append-only triggers/indexes. | Additive tables and grants, but depends on `sample_events_append_only()` and runtime roles. Live API/CSV/import remains disabled. |

Do not bypass migration checksum checks or edit historical migrations. Also review `scripts/migrate.mjs` historical migration iteration/backfill behavior before any real upgrade; integration replay against a fresh synthetic schema does not prove safe reapplication to a populated database.

## Phase 05 concurrency test evidence

Added `src/app/api/metropolis/metropolis.db.integration.test.ts`. It requires a dedicated database whose name includes `test`, creates a uniquely named isolated schema, replays migrations there, sets synthetic-only crypto keys, seeds synthetic centres/staff/patients/orders, and drops its schema afterward. The tested paths include concurrent matching idempotency retries, organization-wide duplicate-reference collision across centre boundaries, occurrence-time conflict on a reused key, concurrent corrections to one event, append-only enforcement, unauthorized centre denial, and schema absence of provider-confirmation fields. Existing API unit tests reject provider-like fabricated states. This suite does not authorize Metropolis connection, data import, report delivery, barcode use, or clinical escalation.

## Phase 06 implementation checkpoint

Canonical routes B001–B015 now have explicit route files. Current records power the billing, payment, home-fee, outstanding, reconciliation, refund and dispute-review views. B002 can create an internal charge snapshot from a confirmed order; this is not invoice issuance. Internal payments are staff evidence records and are not bank/gateway verification. Allocation remains one payment-to-one charge. No settlement, expense, partner contract, invoice-document or export contract was inferred.

| ID | Safe development state | Unresolved acceptance / policy |
|---|---|---|
| B001 | Partial: centre-scoped finance work queue and internal charge records. | Invoice queue and legal issuer workflow. |
| B002 | Partial: confirmed-order internal charge snapshot. | Invoice/linking and approved issuer policy. |
| B003 | Partial: encrypted internal lead quote API exists; new route explains context limit. | Direct quote editor and tested end-to-end link from lead/order. |
| B004 | Restricted: route states no invoice document is available. | Invoice entity, issuer, tax policy and authorized document storage. |
| B005 | Partial: staff-recorded internal payment against a charge. | Real payment evidence verification and independent reconciliation. |
| B006 | Partial: payment ledger and recorded charge allocations. | Split allocation, unapplied-payment workflow and additional coverage. |
| B007 | Partial: request, independent approval, evidence-recorded execution. | Approved execution methods and payment-provider integration. |
| B008 | Partial: current unpaid/part-paid balances and authorized adjustment. | Consent-checked reminders and collection task flow. |
| B009 | Partial: cash count and internal non-cash ledger snapshot. | External UPI/bank verification and exception workflow. |
| B010 | Restricted: explicit unavailable state. | Verified Metropolis invoices/remittances and agreed settlement terms. |
| B011 | Partial: separate view of recorded Rudra home-collection charge rows. | Accounting/tax treatment and expense comparison. |
| B012 | Restricted: explicit contract/issuer gate. | Approved partner contracts, terms, issuer and scoped batch billing. |
| B013 | Restricted: explicit policy gate. | Expense categories, evidence, approvers and accounting rules. |
| B014 | Partial: existing finance summary aggregates. | Scoped export authorization/audit and supported cost/variance sources. |
| B015 | Partial: displays disputed payments and existing adjustment entry point. | Dispute case, issuer-aware invoice correction and credit/debit notes. |

All 15 remain **not finally accepted**. Browser/responsive/manual acceptance and screen-specific integration coverage are pending. Phase 07 readiness is **not established**: finance policy, legal issuer, partner terms, payment proof and manual screen acceptance remain open. No production or persistent development data is claimed.

## Migration and recovery addendum — 14 November 2026

The read-only migration preflight now counts only whether pending CHECK constraints would reject current rows. On this local schema it found **0 unsupported collection event values** for the final 0095/0096/0098 allowlist and **0 website slugs** outside the 0097 allowlist. The 0099 append-only trigger dependency exists; 0094 and 0099 objects are absent as expected. These counts are not a migration rehearsal and do not prove successful upgrade or rollback.

Backfill review: `scripts/migrate.mjs` calls the 0033 lead, 0035 operational and 0039 finance/report backfill routines even when the associated migration is already recorded. The routines are conditional rather than an unconditional full-row rewrite: operational and finance/report routines fill null ciphertext; lead migration also repairs missing/inconsistent contact blind indexes. They decrypt/verify existing rows during the run. Under stable key material and complete rows, a repeat does not re-encrypt every existing payload; incomplete rows/indexes may be written, and the full verification scans can be expensive. Do not run this path against populated data without approved key continuity, backup, preflight and a tested rollback/recovery plan. A key rotation is a separate, explicitly invoked operation.

Recovery evidence is limited to encrypted key-backup/restore tests and synthetic PostgreSQL/private-document key compatibility tests described in `LOCAL_KEY_RECOVERY.md`. That tool backs up keys only. `pg_dump` and `pg_restore` were not found in the local command path, and no complete PostgreSQL plus private-document backup was restored in this task. WAL archive counters were zero with no last archive time; this does not establish that all backup designs are unusable. Full backup-source inventory, restore rehearsal and RPO/RTO measurement remain outstanding.

## Read-only database preflight result — 14 November 2026

Reran `node scripts/audit-migration-readiness.mjs` after the code and test milestone. Both configured connections were loopback-only and opened transaction-read-only sessions on `rudra_health_dev` (PostgreSQL 17.11). The migrator and application roles are non-superusers without CREATEDB/CREATEROLE; the application role has no finance DELETE privilege. The ledger remains at 0093 with no checksum/unknown entries; 0094–0099 remain unapplied. Current check counts remain zero for unsupported collection event values and disallowed website slugs. The 0099 trigger dependency is present; quote and Metropolis schema objects are absent. WAL archiver counters are zero. No database objects or data were changed. These checks do not replace isolated application of pending migrations or a complete backup/restore drill.
