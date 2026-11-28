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

## Synthetic browser evidence checkpoint — 25 November 2026

GitHub Actions run [45548280139](https://github.com/vaishnavsawant1994-stack/Rudra-Health-Care-Centre/actions/runs/45548280139) at commit `1f885d987883ac8ca7c5f1d37a37e9ef1587e90d` passed the finance Chromium workflow, full-history secret scan, dependency audit and quality job (lint, typecheck, full Vitest suite, production build and inventory reconciliation). The PR-triggered run for the same commit also completed quality, browser and dependency jobs successfully; its full-history secret scan failed on the previously documented historical fixture findings. The push scan passed, but does not replace the PR scan result.

The browser workflow added these limited, positive findings:

- **B005/B006:** a synthetic finance operator recorded payment evidence against an authorized charge. The API returned `201`; a disposable PostgreSQL assertion confirmed a centre-linked payment/allocation, encrypted private evidence and one audit event. The ledger displayed the saved payment as `RECORDED`. This is staff-entered evidence, not provider or bank settlement.
- **B008:** the outstanding view continued to show the charge as `INR 450.00` and `UNPAID` after the unverified evidence was recorded. The test confirms recorded evidence does not reduce the payable balance as if settled. Reminder and adjustment workflows were not exercised.
- **B009:** one synthetic MFA user opened a reconciliation and a distinct synthetic MFA user closed it. The API returned `201` for both actions; disposable PostgreSQL assertions verified the persisted state, distinct opener/closer, matching expected/count values, and zero variance. This does not verify bank/UPI statement matching or settlement.
- **B011:** the home-fees view rendered a separately categorized synthetic `HOME_COLLECTION` charge. This did not qualify fee calculation, waiver reporting, tax/accounting rules, or expense comparison.
- **B014:** Chromium verified the explicit export restriction. No export workflow was performed; scoped export permission, privacy review and immutable export-audit requirements remain pending.

The recorded workflow used a real synthetic Better Auth/TOTP session, a second independently authenticated closer, and disposable PostgreSQL fixtures. One wrong-centre finance mutation was denied with `403`. Responsive viewport assertions in this test cover the order-billing view (1280, 768 and 390 pixels), not each screen above. Keyboard/screen-reader accessibility and approved-image comparisons were not established by this run.

Accordingly, B005, B006, B008, B009 and B011 have **specific functionally verified paths**; B014 has a **verified restriction**. These results do not make any of the six screens technically complete, and no protected acceptance field or Owner/QA status was changed. B003 and the other Phase 06 screens were not exercised in this browser journey. Current explicit restrictions for B003/B004/B007/B010/B012/B013/B015 remain as listed above.

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


## B003 and connected Phase 07 browser evidence ? 25 November 2026

GitHub Actions push run [45611660102](https://github.com/vaishnavsawant1994-stack/Rudra-Health-Care-Centre/actions/runs/45611660102) passed all four jobs on commit `b7719963ed8eafe2aed8fb8b80b9654617aa0c5a`. The PR-triggered run [45611672221](https://github.com/vaishnavsawant1994-stack/Rudra-Health-Care-Centre/actions/runs/45611672221) passed browser, dependency and quality jobs; its full-history secret scan remains failed on the known historical fixture findings.

The authenticated Chromium journey exercised B003: it created an internal quote draft from an authorized synthetic lead (HTTP 201), verified its catalogue-version snapshot and total in the UI, opened quote details, and checked lead-scope denial for a cross-centre lead and an unknown quote. Disposable PostgreSQL assertions confirmed the lead link, `INTERNAL_DRAFT` state and encrypted snapshot. This is internal draft functionality only; it does not approve pricing, enable public delivery or issue an invoice.

CI at this commit passed **1,015/1,015 tests across 253 files**, lint, TypeScript, production build (**406 static pages generated**), inventory reconciliation, push full-history secret scan and dependency audit. These results do not establish Owner/QA acceptance, pixel parity or full accessibility.
