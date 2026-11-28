# Communications & AI reference designs A001–A013

## Scope

The supplied references show 13 Communications & AI screens. Their Rudra Health OS design previews are implemented at `/communications/design/a001` through `/communications/design/a013`. The existing protected, data-backed communications inbox remains available at `/communications`.

Each preview has a dedicated screen title, summary metrics, section tabs, data panels, tables, conversation examples, workflow diagrams, and screen-specific synthetic content. The layouts share a high-density desktop workspace shell and adapt to smaller viewports.

## Demo data and actions

Names, counts, contact references, conversations, statuses, dates, and staff labels are synthetic examples. The screens do not load patient records or real communication history. Calls, WhatsApp/SMS/email, provider events, payment and campaign sending are not connected. A separate protected governance workbench now persists encrypted, centre-scoped, versioned draft policies and knowledge entries; this is not provider configuration, publication or model access. Preview controls show an explanation instead of performing those actions.

For local visual review without staff sign-in, use `/design-preview/communications/a001` through `/design-preview/communications/a013`. The existing `src/app/design-preview/layout.tsx` makes that preview unavailable in production. The signed-in communications route requires `workspace.read`.

## Acceptance status

ESLint and production build passed. The build generated 277 static-generation entries. Local HTTP smoke checks returned 200 for all 13 preview URLs and verified each screen code and the synthetic-data label.

Pixel-level desktop and mobile acceptance remains pending. Windows Computer Use could not inspect the browser because it could not reliably determine the current browser URL. The full existing Vitest run reported 829 passed and 11 skipped, with one inventory-reconciliation failure on W008: its mapping expects the old `<PublicEnquiryForm mode="booking" />` marker, while the current booking page uses `RudraBookingFlow`. No booking source was changed as part of these designs.

These are design previews and do not qualify the underlying external communication providers, operational workflows, or the 13 screens for production use.

## Phase 08 functional coverage addendum — 14 November 2026

Canonical routes now exist for all A001–A013. `/chat` is a deterministic catalogue/service guide and public-enquiry handoff, not an AI agent. Support queue and detail reuse encrypted, centre/role-scoped support tasks. `/communications/inbox` shows only recorded enquiries, CRM drafts and permitted follow-ups. Campaign and template screens reuse existing internal records. WhatsApp/voice and knowledge pages support non-secret internal drafts with encrypted version history; they do not activate external services or publish knowledge. Conversation ingestion and AI quality review remain unavailable. No external delivery, call, recording or model invocation was added. See `PHASE_08_COMMUNICATIONS_ACCEPTANCE.md` for row-by-row evidence and restrictions.

The previous design-reference preview remains synthetic and is not a live communications backend. Full browser/visual/keyboard acceptance remains outstanding.

## Current Phase 08 implementation verification — 14 November 2026

Phase 08 governance policy/API tests and isolated PostgreSQL tests: 8/8; inventory reconciliation: 14/14; combined focused run: 22/22 across four files; full Vitest: 942/942 across 235 files; ESLint and TypeScript: passed; production build: passed with 377 generated pages. These results do not convert reference screenshots into visual acceptance or validate external providers. The A001–A013 routes and restrictions are detailed in `PHASE_08_COMMUNICATIONS_ACCEPTANCE.md`; all remain pending manual acceptance.
