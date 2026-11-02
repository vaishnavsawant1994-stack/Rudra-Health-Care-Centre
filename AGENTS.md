# Rudra Health OS — Coding Agent Instructions

## Authority and starting point
- This is a **brand-new VS Code codebase**. Do not clone, import, reference, or reuse any code from an older Rudra repository.
- Product requirements are in `docs/SCREEN_SPEC_178.md` and `docs/DECISIONS.md`. The specification is a **target**, not proof of implementation.
- Follow `docs/ARCHITECTURE.md`, `docs/PHASES_AND_ACCEPTANCE.md`, and the user's latest explicit instructions.
- Never pretend a screen or business action is complete before working code and tests demonstrate it.

## Core product
Build **Rudra Health Care Centre — Rudra Health OS**: one responsive web application containing the public website, patient/family portal, reception CRM, field staff, branch/logistics, billing, owner administration, social/marketing, communications/AI and controlled Metropolis integration. One domain model and backend; no separate disconnected CRM.

## Non-negotiable business rules
1. Rudra is the primary customer-facing brand. Metropolis Healthcare is the diagnostic franchise/laboratory partner. Do not use Metropolis branding or assert accreditation beyond what is contractually authorized.
2. Diagnostic test/package customer prices equal approved Metropolis rates. Do not automatically mark up tests. Home-collection service charges are separately recorded and manually selectable: ₹0, ₹75, ₹99, ₹150 or authorized custom amount, with price disclosure and audit.
3. Metropolis APIs are **optional**. Manual-first workflows must function: staff-entered verified references, approved CSV import, authorized report attachment, event logging, sample handover, branch receipt and dispatch. Future API adapters must not require rewriting core workflows.
4. Both Rudra-issued and Metropolis-issued invoice records must be representable, but the legal invoice/settlement arrangement is pending. Do not generate duplicate tax invoices.
5. Patient & Family 360° with individual Patient IDs, confidentiality boundaries, meaningful consent and family-specific authorization. A family link alone does not authorize access to another adult's results.
6. One verified event history powers the patient's service journey, staff job details and admin operational views. Never fabricate lab progress, payment confirmation, report authorization or event timestamps.
7. Owner has final business authority with delegated, scoped, audited staff permissions. Marketing roles must not access private clinical records.
8. AI may assist with approved customer services, with identity checks, consent, rate limits, clear handoff and no autonomous diagnosis or marketing spending.

## Engineering principles
- Start with a modular monolith: Next.js App Router + TypeScript + PostgreSQL, not microservices. Keep business rules in `src/modules/` or `src/server/`, not React components.
- Use server-enforced authorization on every privileged read/write, validated payloads, idempotency for booking/payment/integration endpoints, audit trails for mutations, and transactions for related changes.
- Design for multi-centre isolation now. Do not add unscoped record queries.
- Use separate domain objects for patient, booking, appointment, order, specimen, assignment, custody event, payment, issued invoice, external lab reference and timeline event.
- Protect medical reports and documents; private storage and short-lived, authorized access only.
- Support accessible, responsive states: loading, empty, error, denied, offline, retry and success.
- Keep dependencies current and compatible; avoid deprecated or pre-release packages without documented approval.
- No actual patient/medical data, production secrets, credentials, unsanitized exports or genuine outbound messages while in development.
- Add useful tests for each vertical slice. `npm run lint`, `npm run build`, and available tests must pass before a milestone is marked complete.
- Prefer small, reviewable implementation slices. Document what was built, how to run it, what's unimplemented, and what tests were performed.

## Work order
- First implement **Phase 00** from `PROMPT_01_FOR_VS_CODE_AGENT.md`.
- Do not implement all 178 screens at once. Build reusable UI and backend contracts in verified phases.
- Preserve the IDs of all 178 target screens for traceability; routes may be grouped into tabs if interactions and acceptance requirements are retained.

## Hard safety gates
- No simulated 'real' payments, reports, patient data, lab milestones or approval events.
- No production launch before security, legal/franchise, invoice issuer, privacy, clinical operating procedures and backup/restore qualification.
- When external Metropolis state is uncertain, show 'Awaiting verification' and provide an authorized manual verification workflow.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
