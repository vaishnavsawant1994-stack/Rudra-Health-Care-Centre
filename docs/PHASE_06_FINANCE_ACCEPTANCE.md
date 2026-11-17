# Phase 06 — Billing, Payments & Finance (B001–B015)

**Checkpoint:** 14 November 2026. **State:** partial/restricted development; 0/15 finally accepted. All live UI/API records are centre- and role-authorized. Examples in tests use synthetic data only.

| ID | Canonical route | Current implementation | Automated evidence | Pending acceptance / restriction |
|---|---|---|---|---|
| B001 | `/finance/billing` | New centre-scoped queue built on existing charge/payment summary. | Existing finance API and policy tests; new workspace not yet separately component-tested. | Internal charges only; legal invoice queue blocked on issuer approval. |
| B002 | `/finance/orders/[id]/bill` | Confirmed-order snapshot and idempotent internal charge creation. | Existing finance route tests. | No tax/legal invoice; route has no separate visual acceptance. |
| B003 | `/finance/quotes/[id]` | Internal encrypted lead quote service and route-level explanation. | Existing quote API/policy coverage. | Route needs lead/quote linkage to edit/view a direct quote; public delivery remains disabled. |
| B004 | `/finance/invoices/[id]` | Explicit restricted state. | No invoice entity available in current finance schema. | Do not issue or imply legal invoices until issuer/tax document policy is approved. |
| B005 | `/finance/payments/new` | Records staff-entered payment evidence against one authorized charge. | Existing API integration and idempotency tests. | No external gateway verification or generated receipt. |
| B006 | `/finance/payments` | Centre-scoped payment ledger with current single-charge allocations. | Existing finance API tests including pagination/filtering. | Split/unapplied allocation workflow and acceptance remain pending. |
| B007 | `/finance/refunds` | Separate request, independent decision and evidence-reference execution states. | Existing refund API tests. | No live refund provider; internal evidence is not provider confirmation. |
| B008 | `/finance/outstanding` | Unpaid/part-paid balance view and audited adjustment. | Existing finance API tests. | Reminder workflow requires consent and message policy. |
| B009 | `/finance/daily-close` | Reuses reconciliation and cash/non-cash ledger snapshot. | Existing PostgreSQL reconciliation integration. | No external bank/UPI statement matching or settlement assertion. |
| B010 | `/finance/metropolis` | Explicit restricted state; no external settlement values shown. | No settlement schema/source contract. | Requires approved Metropolis bill/remittance and settlement terms. |
| B011 | `/finance/home-fees` | Filters Rudra home-collection charge records separately from diagnostics. | Existing finance API source; new screen not separately tested. | Taxes/accounting and expenses comparison require approved rules. |
| B012 | `/finance/partner-billing` | Explicit restricted state. | No approved contract/credit/issuer contracts found. | No batch invoicing until legal/contract approval. |
| B013 | `/finance/expenses` | Explicit restricted state. | No expense entity/policy contract found. | Need categories, approvals, evidence retention, accounting policy. |
| B014 | `/finance/analytics` | Existing supported charge/payment aggregate summary; exports explicitly unavailable. | Existing finance summary tests. | No cost/margin claims or export pending source, permission and audit controls. |
| B015 | `/finance/disputes` | Displays recorded disputed payments and existing charge adjustment entry point. | Existing finance route tests; new workspace not separately tested. | Dedicated dispute/correction/credit-note lifecycle and issuer checks absent. |

Diagnostic catalogue retail and home-collection fees stay separate. Current finance policies keep legal invoice issuance disabled when issuer responsibility is pending. Internal payment records do not prove bank, UPI, card or gateway settlement. Every screen remains pending manual browser/mobile and visual acceptance. See [`PHASE_05_06_READINESS.md`](PHASE_05_06_READINESS.md) for migration, provider, legal and scope limitations.

## Verification checkpoint

- Focused finance API/policy/quote and screen-inventory tests: **32/32 passed** across five files.
- Focused Phase 05 Metropolis API/crypto/PostgreSQL integration tests: **15/15 passed** across five files.
- Full Vitest suite: **919/919 passed** across 226 files.
- ESLint: passed. TypeScript: passed. Production build: passed; Next.js generated 357 static/partial-prerender entries.
- Inventory reconciliation: 178/178 canonical IDs retained; 118 exact source-route matches, 60 without an exact route. These are route counts, not completion counts.
- Local migration readiness inspection: read-only and no DB changes. Combined DB role verification was not rerun because it would not be safe to reconcile the existing 0093 database against source migrations without a qualified backup/restore plan.
- Browser/mobile comparison and screen-by-screen acceptance: not performed.

## Wave 3 upstream workflow boundary — 15 November 2026

The cross-module test leaves the diagnostic order pending because the selected catalogue version is explicitly synthetic and unverified. It records no customer-facing diagnostic total, invoice, payment, refund or provider settlement. Existing supported finance API tests remain separate; this workflow does not qualify billing/legal issuer or payment acceptance.
