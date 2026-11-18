# Phase 01 public browser verification — 18 November 2026

This checkpoint records evidence from an isolated production-mode application built from the current review-branch source, using a disposable `rudra_health_test` schema, synthetic catalogue records and disabled external providers. It does not change the canonical screen inventory or grant Owner/QA approval.

## Results

- W001–W026 public routes rendered successfully in Chromium; intentional redirects were observed for W014 (`/track` to `/track-booking`) and W020 (`/partner` to `/partners`).
- All 26 routes were measured at desktop (1440px), tablet (768px) and mobile (390px) widths: 78 viewport checks, zero horizontal overflow after the shared tablet catalogue layout correction.
- W003 retained its first 24 catalogue entries after an injected page-two HTTP 503, then loaded 31 unique entries after retry.
- W004’s test detail exposed the synthetic published service; its booking link preserved centre, catalogue item and version.
- W005 enforced the three-package comparison limit; W006 showed its synthetic included test.
- W007/W008 submitted a real synthetic enquiry to the isolated API; the submitted catalogue version remained selected, and W010 showed a privacy-safe acknowledgement that did not expose contact details or claim a confirmed appointment.
- W009 remained unavailable for payment. W022’s FAQ shortcut worked with keyboard focus and Enter.
- W018 corporate, W019 doctor, W020 partner, and W021 contact forms each accepted a synthetic submission with HTTP 202 and rendered a staff-review receipt. The receipt explicitly said no message, call, or marketing communication was sent automatically.
- Browser checks reported zero JavaScript exceptions and zero HTTP 5xx responses.
- Full Vitest: **990 tests passed across 251 files**. Focused booking/CSRF tests: **12 passed**. ESLint and TypeScript passed.
- Production build in the isolated runtime passed with **406 generated route entries**. The browser runtime used the same Next.js 16.4.6 source and an isolated test schema; no persistent development database was used.

Evidence JSON and screenshots are stored outside the repository at `F:\Rudra Health Care Centre\Rudra Health OS Audit\Public_Phase01_Acceptance_2026-11-18_R1\evidence`.

The isolated Next.js server is stopped. The disposable schema created for this run was verified in `rudra_health_test` and dropped; the persistent development database was not touched. Removal of the external test-only `.env.local` remains blocked because the approved PowerShell cleanup command was rejected by the execution policy. Its ACL still limits access to SYSTEM, Administrators and the current user. The file has not been read into output or copied into the repository.

## Source changes prompted by browser testing

- Catalogue detail links now initialize the booking form from the exact centre, item and version. The server catalogue detail endpoint revalidates that exact selection; unavailable or stale links are not silently replaced by another item.
- Same-origin write protection now accepts a matching `Referer` when Chromium omits `Origin`; explicit cross-site fetch metadata and nonmatching origins/referers remain rejected.
- Shared catalogue filters switch to a two-column tablet layout, eliminating the measured 24px overflow on W003, W005 and W025 at 768px.

## 19 November accessibility correction

- Source inspection found public child pages rendering nested `<main>` landmarks inside the root layout's `main#main-content`. Replaced those child landmarks with neutral `div` containers across the affected Phase 01 routes and shared public components, preserving the root skip-navigation landmark.
- Catalogue detail content now uses an `h1`; the package directory supports an `h2` when embedded under the offers page's own `h1`, avoiding duplicate page-level headings.
- Regression tests cover the catalogue directory's page-heading and embedded-section-heading variants. Focused checks passed: 8 tests across 7 files; ESLint and TypeScript passed.
- This source-level correction has not yet had a fresh full Playwright run against populated synthetic catalogue data. Prior 78 route/viewport measurements remain valid for the unchanged layout but do not test the new semantic markup.
- No approved W001–W026 design master images were found in the repository or available attachment set. Pixel/visual-reference comparison remains unverified. Axe/assistive-technology audit was not run; the source corrections and tests do not constitute full accessibility acceptance.
- The Picomatch advisory remains unresolved and visible as a release qualification issue.

## Disposition and limits

All 26 routes have browser rendering evidence, and the listed interactions have production-mode Chromium evidence. This does not establish that every control on every screen is complete. No approved canonical visual references were available in this runtime for a paired pixel comparison; a full assistive-technology audit and manual Owner/QA review were not performed. W009, W014–W017 and W023–W026 remain restricted as documented in `PHASE_01_PUBLIC_ACCEPTANCE.md`. No Phase 01 screen is promoted to technically complete or Owner/QA accepted on this checkpoint alone.
