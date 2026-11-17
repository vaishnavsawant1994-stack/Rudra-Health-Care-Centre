# Phase 09 — Social Media, Content & Digital Marketing (M001–M018)

**Status:** internal development partial/restricted; **0/18 finally accepted**. **Data:** live application screens show authorized internal records only; test data is synthetic. **Provider state:** no social, search, analytics, or advertising provider is connected. No posts, comments, reviews, impressions, reach, spend or external publication results are fabricated.

**Verification:** Phase 09 focused campaign/content/route/crosswalk checks passed **31/31 across seven files** (inventory/crosswalk tests: **15/15**); full Vitest passed **943/943 across 235 files**; ESLint and TypeScript passed; production build passed with **380 generated pages**. These results do not provide manual browser, visual, responsive, keyboard or policy acceptance.

Canonical identity is preserved in [`MARKETING_SCREEN_CROSSWALK_M001_M018.md`](MARKETING_SCREEN_CROSSWALK_M001_M018.md). Screenshot-preview IDs M008–M016 conflict with the original spec; preview names are not canonical. The 18-row evidence overlay is maintained beside the external audit report.

| ID | Canonical route | Implemented frontend/workflow | Backend/database evidence | Provider and policy state | QA and acceptance |
|---|---|---|---|---|---|
| M001 | `/marketing` | Live dashboard shows selected centre's actual campaign/content record counts, lead conversions and linked appointments; navigation to canonical workspaces. | `/api/marketing/centres`, `/api/marketing/campaigns`, `/api/marketing/content`; records are centre-scoped. | External reach, engagement, spend, payments and diagnostic completion are not shown. | Full tests/build recorded in tracker; manual review pending; not accepted. |
| M002 | `/marketing/accounts` | Reports NOT CONFIGURED with no fabricated account/token state. | No social-account registry or OAuth API. | OAuth and provider connection disabled. | Route and inventory check; not accepted. |
| M003 | `/marketing/studio` | Encrypted internal content drafts, version edit, submit-to-review, history. | Existing content API/table/event lifecycle; `marketing.manage`. | No asset attach/publish; clinical claims require qualified review. | Existing content policy/API/isolation tests; not accepted. |
| M004 | `/marketing/assets` | Explains unavailable asset library; does not offer unsupported upload. | No asset/media storage or rights schema. | Licensed content and patient-image consent cannot be verified. | Route and inventory check; not accepted. |
| M005 | `/marketing/calendar` | Shows recorded draft/review/approved/scheduled items. | Existing content list and planned date API. | Planned time is not a provider schedule or publication. | Existing content integration tests; not accepted. |
| M006 | `/marketing/approvals` | Filters content to in-review and exposes existing review actions. | Existing API rejects creator self-approval, versions transitions, records audit history. | Qualified medical/legal reviewer roster and complete approval checklist absent. | Existing independent-review tests; not accepted. |
| M007 | `/marketing/publishing` | Shows internal scheduled planning records and labels delivery unavailable. | Existing `SCHEDULED` content rows only; no publishing queue table. | No adapter, retry, external event or publishing evidence. | Existing scheduled-state test; not accepted. |
| M008 | `/marketing/meta` | Provider-disconnected notice; links to internal content and communication workflows. | No Meta post/comment/insight APIs or imported records. | No scraping; no replies. | Route/inventory; not accepted. |
| M009 | `/marketing/youtube` | Provider-disconnected video workspace. | No YouTube integration or analytics API. | Upload/schedule/analytics disabled. | Route/inventory; not accepted. |
| M010 | `/marketing/linkedin` | Provider-disconnected corporate workspace; links to protected corporate relationship directory. | No LinkedIn integration; existing C001–C012 remain separate. | Publishing/insights disabled. | Route/inventory; not accepted. |
| M011 | `/marketing/local` | Provider-disconnected local listings/reputation workspace. | No Google Business location/review data. | No review or reply is fabricated. | Route/inventory; not accepted. |
| M012 | `/marketing/campaigns` | Internal campaign registry, date window, status, tracked leads/conversions/appointments, change history. | Existing encrypted campaign registry/lifecycle and centre-scoped aggregate API. | Active means internal attribution tracking; no ad launch or spend. | Existing campaign tests; not accepted. |
| M013 | `/marketing/ads` | Explicitly gated advertising oversight. | No ad account, spend, budget-ceiling or spend-approval tables/API. | No connect/spend/pause actions. | Route/inventory; not accepted. |
| M014 | `/marketing/website` | Protected handoff to existing website CMS and public offers. | Existing CMS and separate `website.content.manage` boundary. | Existing editorial policy controls; marketing route cannot bypass it. | Existing CMS checks; end-to-end marketing flow not accepted. |
| M015 | `/marketing/seo` | States external search metrics are unavailable. | No Search Console, analytics, ranking or impression API. | No metrics are inferred. | Route/inventory; not accepted. |
| M016 | `/marketing/community` | Explicitly states external community records are unavailable; links internal support/communications. | No social-message ingestion/reputation-case API. | Replies disabled; no medical information in public messages. | Route/inventory; not accepted. |
| M017 | `/marketing/attribution` | Read-only recorded lead/conversion/appointment cohort view, with date filters. | Existing campaign API, `leads`, conversions and appointment aggregates; no patient rows returned. | Payment attribution absent; appointment counts do not prove payment or completed diagnostics. | Existing attribution API and PostgreSQL tests; not accepted. |
| M018 | `/marketing/governance` | Restricted state links to current roles, audit and finance workspaces. | Existing general `marketing.read/manage` grants and audit; no marketing-specific delegation/budget record. | No platform scopes, spend caps or dedicated budget approvals. | Route/inventory; not accepted. |

## Prioritized outstanding work

1. Resolve product owner approval for the M008–M016 design crosswalk before treating the later preview images as canonical requirements.
2. Add a governed asset store, licence/consent evidence and version-linked attachment workflow before media reuse.
3. Add qualified reviewer roles, claim/source checks and permission-separated workflow for medically sensitive content.
4. Build approved provider adapters, connection health, idempotent publishing and externally confirmed result records only after provider authorization.
5. Add audience/opt-out suppression, channel preferences, interaction handling and consent-safe lead attribution before any outreach.
6. Add budget ceilings and independent finance/owner approvals before paid media planning can authorize spend.
7. Connect approved analytics/search sources before reporting reach, SEO, visits, conversion or spend metrics.
8. Complete screen-by-screen desktop/mobile, keyboard, responsive and visual comparison. No test or route count substitutes for this acceptance.

## Database and project limits

No new Phase 09 migration was added. Existing database state remains at migration 0093; source migrations 0094–0100 remain unapplied. No deployment, external publishing, provider activation, production data access, commit or push occurred. Prior phase blockers (identity proofing, legal invoice issuer, Metropolis approvals, encryption key recovery/backup restore, clinical content policy) remain open.
