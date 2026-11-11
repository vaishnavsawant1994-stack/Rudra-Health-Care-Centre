# Communications & AI reference designs A001–A013

## Scope

The supplied references show 13 Communications & AI screens. Their Rudra Health OS design previews are implemented at `/communications/design/a001` through `/communications/design/a013`. The existing protected, data-backed communications inbox remains available at `/communications`.

Each preview has a dedicated screen title, summary metrics, section tabs, data panels, tables, conversation examples, workflow diagrams, and screen-specific synthetic content. The layouts share a high-density desktop workspace shell and adapt to smaller viewports.

## Demo data and actions

Names, counts, contact references, conversations, statuses, dates, and staff labels are synthetic examples. The screens do not load patient records or real communication history. Calls, WhatsApp/SMS/email, provider events, payment, campaign sending, and configuration persistence are not connected. Preview controls show an explanation instead of performing those actions.

For local visual review without staff sign-in, use `/design-preview/communications/a001` through `/design-preview/communications/a013`. The existing `src/app/design-preview/layout.tsx` makes that preview unavailable in production. The signed-in communications route requires `workspace.read`.

## Acceptance status

ESLint and production build passed. The build generated 277 static-generation entries. Local HTTP smoke checks returned 200 for all 13 preview URLs and verified each screen code and the synthetic-data label.

Pixel-level desktop and mobile acceptance remains pending. Windows Computer Use could not inspect the browser because it could not reliably determine the current browser URL. The full existing Vitest run reported 829 passed and 11 skipped, with one inventory-reconciliation failure on W008: its mapping expects the old `<PublicEnquiryForm mode="booking" />` marker, while the current booking page uses `RudraBookingFlow`. No booking source was changed as part of these designs.

These are design previews and do not qualify the underlying external communication providers, operational workflows, or the 13 screens for production use.
