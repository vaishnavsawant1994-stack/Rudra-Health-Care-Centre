# P2-07 — Payments, Billing & Financial Operations

## Status

Implemented for synthetic-data local development. The module records internal financial events only. Legal/tax invoices, live payments, real refunds, payment-provider verification, and production use remain disabled.

## Screens and routes

- `/finance` — owner/centre financial summary, recent charges/payments/activity, and charge snapshot creation.
- `/finance/payments` — payment directory and allowed confirmation/reversal actions.
- `/finance/payments/new` — record a manual payment against an outstanding charge.
- `/finance/payments/[id]` — payment detail/history view.
- `/finance/outstanding` — balances and reasoned charge adjustments.
- `/finance/refunds` — refund request, separate-person approval, and execution evidence recording.
- `/finance/reconciliation` — daily centre cash opening/closing, variance, and handover. Non-cash settlement reconciliation is not implemented.
- `/finance/policies` — per-centre charge issuer responsibility state.
- `/finance/exceptions` — disputed payments and refund requests needing review.
- `/finance/orders/[id]` — order billing snapshot and charge creation.
- Financial history is linked in Patient 360°, Appointment Details, and Diagnostic Order 360° for appropriately authorized staff.

## Data and APIs

- Forward-only migrations `0015_financial_operations.sql` through `0019_financial_event_evidence.sql` add billing responsibility policy, immutable charges, payments, allocations, adjustments, refunds, append-only financial events, cash reconciliation, and reversal evidence.
- `GET/POST /api/finance` serves centre-scoped reads and authorized mutations. POST body actions create order charge snapshots, record/confirm/dispute/reverse payments, record adjustments, request/approve/reject/record refund execution, open/close reconciliations, and update billing responsibility.
- `/api/finance/patient-history`, `/appointment-history`, and `/order-history` require authenticated financial access plus the relevant tenant/centre scope. Patient history also requires `patients.read`.
- All mutations require same-origin CSRF validation, an idempotency key, Better Auth session/MFA authorization, server-side permission checks, and transactional persistence. Payment allocation and refund limits lock their parent records against concurrent over-allocation.
- Money is kept in integer minor units for ledger operations. Confirmed diagnostic order totals are parsed from exact decimal strings and their service price/source snapshots are copied into the internal charge snapshot. Rudra home-collection charges remain separate.
- Financial audit descriptions contain action/status references, not amounts, payment references, or free-text reasons. Financial event records keep the restricted operational details. Charge, allocation, adjustment, and event history cannot be updated/deleted by the runtime role.

## Business and safety rules

- Diagnostic customer prices continue to come from the confirmed catalogue/order snapshot. The financial module adds no diagnostic markup.
- Invoice issuer defaults to `PENDING`. Rudra, Metropolis, or separate issuer responsibility can be recorded per charge type and centre, but `legal_invoice_enabled` is constrained to false. No legal/tax invoice is created.
- Home collection fee snapshots copy the separately authorized appointment charge; they are not folded into diagnostic test/package prices.
- Payment records are explicitly `RECORDED` until an authorized staff member reviews and confirms/disputes them. This review is not an independent provider/bank verification.
- Refund request, approval, and execution evidence are separate states. The requester cannot approve their own refund; requested/approved/executed amounts reserve refundable balance. Recording execution evidence does not call a gateway or prove settlement.
- Corrections use immutable signed adjustments with a reason. A discount cannot reduce the charge below the already net-paid amount.
- Cash expected closing is derived from opening cash, confirmed cash entries, and recorded cash refunds. Closing requires a different staff member from the opener; the counted amount and variance are retained.
- Payment references are limited to 200 characters. No card number, CVV, bank login, or payment credential is accepted or stored.
- Invoice responsibility and tax treatment are unresolved. Internal charge/payment records are not legal invoices or tax receipts.

## Verification results (2026-10-29)

- `npm.cmd ci --dry-run --ignore-scripts` — passed; dependency lockfile resolved without installation changes.
- `npm.cmd run lint` — passed.
- `npm.cmd run typecheck` — passed.
- `npm.cmd test` — passed: 30 files, 92 tests, including financial access boundary and exact-minor-unit arithmetic tests.
- `npm.cmd run db:migrate` — passed; 19 migrations verified, 0 pending at final check.
- `npm.cmd run db:integration` — passed on dedicated PostgreSQL test database with synthetic data and transaction rollback. Migration replay, pending issuer/legal invoice default, charge snapshot records, partial allocation, reversal evidence, refund separation of duties/execution, reconciliation variance, finance permissions, runtime-role privilege limits, and append-only financial events passed.
- `npm.cmd run db:verify-audit` — passed; local audit chain verified (1 event at the last direct verification; integration fixture transactions rolled back).
- `npm.cmd run build` — passed; Next.js production build generated financial pages and APIs.
- `npm.cmd audit --audit-level=low` — passed; 0 vulnerabilities reported.

## Not verified / remaining limitations

- The financial mutation APIs were not exercised with an authenticated browser session; UI actions have not been visually reviewed on desktop/mobile. Existing browser permission restrictions were not bypassed.
- Reconciliation currently covers cash opening/closing and cash variance only. Non-cash UPI, card, and bank settlement reconciliation and staff handover approvals are not implemented.
- The PostgreSQL integration workflow validates database constraints and synthetic ledger lifecycle; it does not establish real card/UPI/bank settlement or full authenticated API acceptance.
- Direct live unauthorized/MFA-incomplete and cross-centre HTTP attempts remain an acceptance gate.
- No actual funds were collected, refunded, or reconciled. No payment gateway, Metropolis system, tax calculation, settlement contract, legal invoice numbering, GST treatment, or issuer policy was configured.
- Application-level encryption remains incomplete. Keep all patient and financial data synthetic; no production deployment or real patient use is authorized.

## Next milestone

P2-08 — Report Management, Delivery & Follow-ups may proceed with synthetic records, while encryption, browser authorization, invoice-issuer/tax policy, and payment workflow acceptance remain open gates. Do not infer test completion or report delivery from a payment.
