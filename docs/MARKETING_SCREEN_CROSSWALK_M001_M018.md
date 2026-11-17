# Phase 09 canonical screen crosswalk (M001–M018)

**Authority:** `docs/SCREEN_SPEC_178.md` remains the source for stable IDs, names and canonical routes. Later screenshot references are preserved as visual alternatives under `/marketing/design/m001`–`m018`; their labels do not redefine the inventory. No images or IDs were renamed or discarded.

## Identity crosswalk

| ID | Original canonical name and route | Later visual-reference name | Current implementation | Resolution |
|---|---|---|---|---|
| M001 | Marketing home dashboard · `/marketing` | Marketing Home Dashboard | `MarketingHomeDashboard`, live centre-scoped campaign/content APIs | Canonical dashboard uses recorded Rudra data only. Preview aggregates remain synthetic. |
| M002 | Connected channels/account health · `/marketing/accounts` | Connected Social Media Channels & Account Health | `RestrictedMarketingScreen` | No social-account OAuth records or verified provider connection; report NOT CONFIGURED. |
| M003 | Content studio & drafts · `/marketing/studio` | Social Media Content Studio & Draft Management | `ContentCalendarWorkbench` | Uses encrypted, versioned internal drafts; the preview image is not a registered asset. |
| M004 | Brand and media asset library · `/marketing/assets` | Brand & Media Asset Library | `RestrictedMarketingScreen` | No asset storage/licence/consent registry; no upload is offered. |
| M005 | Editorial calendar / campaign schedule · `/marketing/calendar` | Editorial Calendar & Campaign Scheduling | `ContentCalendarWorkbench` | Existing planned dates are internal schedule intentions, not publication. |
| M006 | Content medical/brand approval queue · `/marketing/approvals` | Post Review, Medical & Brand Approval Management | `ContentCalendarWorkbench` filtered to `IN_REVIEW` | Existing independent reviewer check is reused. Qualified medical/legal approval assignments and detailed rights checklist remain unimplemented. |
| M007 | Publishing queue & channel results · `/marketing/publishing` | Content Publishing Queue & Platform Delivery Monitoring | `ContentCalendarWorkbench` filtered to `SCHEDULED` | Scheduled state means internal planning only; publisher, retry, external result and manual-publish evidence are unavailable. |
| M008 | Instagram / Facebook content workspace · `/marketing/meta` | Social Inbox, Comments & Engagement Management | `RestrictedMarketingScreen` | Identity conflict. Canonical M008 is Meta platform content; visual M008 is a social interaction inbox. No external post/comment feed exists. |
| M009 | YouTube / video content workspace · `/marketing/youtube` | Social Reviews & Online Reputation Management | `RestrictedMarketingScreen` | Identity conflict. Canonical M009 is YouTube/video; visual M009 is reviews/reputation. No YouTube or review integration exists. |
| M010 | LinkedIn / corporate campaigns · `/marketing/linkedin` | Marketing Campaign Builder & Campaign Management | `RestrictedMarketingScreen` | Identity conflict. Canonical M010 is LinkedIn/corporate; visual M010 is a campaign builder. Campaign records belong to canonical M012. |
| M011 | Google Business & reputation · `/marketing/local` | Campaign Audience & Budget Management | `RestrictedMarketingScreen` | Identity conflict. Canonical M011 is Google Business/reputation; visual M011 is audience/budget planning. No Google Business or budget module exists. |
| M012 | Campaign directory and planner · `/marketing/campaigns` | Marketing Analytics & Performance Dashboard | `CampaignWorkbench` | Canonical page manages internal campaign attribution records. Preview M012 analytics remain synthetic and do not replace M012. |
| M013 | Paid advertising oversight · `/marketing/ads` | Leads Attribution & Conversion Tracking | `RestrictedMarketingScreen` | Identity conflict. Canonical M013 is paid ads; visual M013 is lead attribution. No ad provider, approved budget, or spend record exists. |
| M014 | Landing pages & website CMS · `/marketing/website` | Website SEO & Search Performance | `RestrictedMarketingScreen` with protected CMS handoff | Identity conflict. Canonical M014 is content/CMS; visual M014 is SEO. Existing CMS remains under its own permission and approval workflow. |
| M015 | SEO, search & site performance · `/marketing/seo` | Marketing Automation & Customer Journeys | `RestrictedMarketingScreen` | Identity conflict. Canonical M015 is SEO/search; visual M015 is marketing automation. No search/analytics provider or automation engine exists. |
| M016 | Social interactions / reputation inbox · `/marketing/community` | Marketing Reports & Data Export Control | `RestrictedMarketingScreen` | Identity conflict. Canonical M016 is community interactions; visual M016 is reports/export. No social feed is imported and no marketing export permission is implemented. |
| M017 | Leads attribution & funnel · `/marketing/attribution` | Lead-to-Booking Conversion Funnel | `CampaignWorkbench` read-only attribution mode | Compatible concept, but totals are limited to recorded campaign-linked leads, conversions and appointments. No payment attribution is present. |
| M018 | Marketing access, budgets & audit · `/marketing/governance` | Marketing Access, Budget & Compliance Governance | `RestrictedMarketingScreen` with links to existing RBAC/audit/finance | Only general marketing read/manage grants and existing audit tools exist; platform grants, spend caps and dedicated approvals are not implemented. |

## Treatment of the preview mismatch

The screenshot route is explicitly a **design reference**, not a canonical operational route. The original IDs/routes remain stable. In particular, the 9 visual references for M008–M016 are alternatives whose function/ID labels must not be used as implementation requirements without approval. The visual M017 funnel is a useful presentation of canonical attribution but cannot show payment as if it were recorded. The visual M001–M007 and M018 names broadly align while their synthetic values still are not live data.

## Source evidence and limitations

- Campaign registry, encrypted metadata, lifecycle history and centre-scoped attribution: migration `0084_marketing_campaign_registry.sql`, `/api/marketing/campaigns`, `CampaignWorkbench`.
- Encrypted content drafts, review, optimistic versions, separate reviewer check, internal planned dates and append-only history: migration `0085_marketing_editorial_drafts.sql`, `/api/marketing/content`, `ContentCalendarWorkbench`.
- Public website CMS: `/owner/website-content`, protected by its own `website.content.manage` permission and existing review/publishing policy.
- Social accounts, asset repository, provider events, analytics/search connectors, paid advertising, community ingest, marketing budget governance and external publishing are not implemented.
- Existing source-only marketing migrations predate this milestone. No new migration was added; no existing local database was migrated.
