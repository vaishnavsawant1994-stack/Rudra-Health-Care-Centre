# Public Website Content — Development Slice

## Delivered

- Owner/Admin editor: `/owner/website-content`.
- Structured public pages: `home`, `about`, `home-collection`, `faq`.
- Public viewer: `/information/[slug]` backed by `GET /api/public/content/[slug]`.
- Existing routes `/`, `/about`, `/home-collection`, and `/faq` now request their published CMS version and keep the reviewed static copy as a fallback when no page is published or the content API is unavailable.
- Staff endpoints: `GET` and `PUT /api/admin/website-content`.
- Draft versions and event records are encrypted with the existing field encryption key ring and bound to the Rudra organization/page context.
- Draft saves use an expected-version check. Draft snapshots and event records are append-only. Publishing and unpublishing require the separate `website.content.publish` permission; it is granted to the default Owner role only. Administrators can manage drafts but cannot publish by default.
- Public reads return only published structured text. React renders strings as text; the application does not accept arbitrary page slugs, HTML templates or script content. The endpoint fails closed if multiple organizations publish the same slug.

## Editorial review lifecycle — 2026-11-01

- Drafts now move through `NOT_SUBMITTED`, `PENDING`, `APPROVED`, or `CHANGES_REQUESTED`, bound to the exact draft version. Editing creates a new version and clears any previous review decision.
- A reviewer must have the separate organization-scoped `website.content.review` permission and must differ from the submitting/editor staff member. Review decisions require a reason; review event payloads, including reasons, are encrypted and append-only.
- Only a current-version `APPROVED` draft can be published, and publication remains a separate Owner permission/action. Earlier already-published content remains published; the migration recognizes that historical explicit publication for its published version only.
- Editorial review does not establish clinical, legal, pricing, privacy, or franchise approval. Public content requiring those approvals must remain unpublished until the appropriate source approval exists. No patient portal account creation or sign-in was enabled.
- Migration `0086_website_content_review.sql` was applied locally as an additive migration. Synthetic PostgreSQL lifecycle tests cover independent review, request-changes, stale-review invalidation, encrypted reasons, publication gating, and append-only events. Manual desktop/mobile acceptance is still pending.

## Database

- `0058_website_content_management.sql`: page drafts/publication snapshot, event log, fixed-slug constraint, permissions and least-privilege grants.
- `0059_website_content_versions.sql`: immutable encrypted draft snapshots.
- Both migrations are forward-only and applied locally. No previous patient, Owner, audit or business records were rewritten.

## Verification

- Content/permission/encryption API tests: 11 passed in focused suite.
- Full default Vitest suite: 319 tests across 79 files passed.
- PostgreSQL integration: 59 migrations replayed; synthetic page/version/event persistence and append-only checks passed; runtime-role privilege checks passed.
- TypeScript, lint, production build (186 generated paths) and dependency audit (0 vulnerabilities) passed.

## Limits and gates

- This is a content-management slice, not completion of the public website or portal.
- The CMS replaces content on the fixed public routes only when a page is published; it does not provide navigation editing, media, translations, content approval workflow, import or historical version restoration. `/information/{slug}` remains a direct preview/read route.
- Do not place patient information, unapproved clinical instructions, prices, legal terms or unsupported partner claims in public content. Human content review is still required before publishing.
- Patient account access remains disabled until identity verification, consent and privacy decisions are approved and implemented.
- No production deployment or external publication was performed. Desktop/mobile and authenticated browser acceptance remain pending.
