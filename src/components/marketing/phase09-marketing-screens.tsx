import Link from "next/link";

export const canonicalMarketingScreens = [
  { id: "M001", name: "Marketing home dashboard", route: "/marketing", module: "home" },
  { id: "M002", name: "Connected channels/account health", route: "/marketing/accounts", module: "accounts" },
  { id: "M003", name: "Content studio & drafts", route: "/marketing/studio", module: "studio" },
  { id: "M004", name: "Brand and media asset library", route: "/marketing/assets", module: "assets" },
  { id: "M005", name: "Editorial calendar / campaign schedule", route: "/marketing/calendar", module: "calendar" },
  { id: "M006", name: "Content medical/brand approval queue", route: "/marketing/approvals", module: "approvals" },
  { id: "M007", name: "Publishing queue & channel results", route: "/marketing/publishing", module: "publishing" },
  { id: "M008", name: "Instagram / Facebook content workspace", route: "/marketing/meta", module: "meta" },
  { id: "M009", name: "YouTube / video content workspace", route: "/marketing/youtube", module: "youtube" },
  { id: "M010", name: "LinkedIn / corporate campaigns", route: "/marketing/linkedin", module: "linkedin" },
  { id: "M011", name: "Google Business & reputation", route: "/marketing/local", module: "local" },
  { id: "M012", name: "Campaign directory and planner", route: "/marketing/campaigns", module: "campaigns" },
  { id: "M013", name: "Paid advertising oversight", route: "/marketing/ads", module: "ads" },
  { id: "M014", name: "Landing pages & website CMS", route: "/marketing/website", module: "website" },
  { id: "M015", name: "SEO, search & site performance", route: "/marketing/seo", module: "seo" },
  { id: "M016", name: "Social interactions / reputation inbox", route: "/marketing/community", module: "community" },
  { id: "M017", name: "Leads attribution & funnel", route: "/marketing/attribution", module: "attribution" },
  { id: "M018", name: "Marketing access, budgets & audit", route: "/marketing/governance", module: "governance" },
] as const;

export type MarketingModule = typeof canonicalMarketingScreens[number]["module"];

const descriptions: Record<Exclude<MarketingModule, "home" | "studio" | "calendar" | "approvals" | "publishing" | "campaigns" | "attribution">, { state: string; detail: string; links: Array<[string, string]> }> = {
  accounts: { state: "NOT CONFIGURED", detail: "No verified social, video, LinkedIn, or Google Business provider account is connected. OAuth, token storage, synchronization, and revocation are unavailable in this development environment.", links: [["/marketing/design/m002", "Open clearly labelled synthetic design reference"]] },
  assets: { state: "ASSET LIBRARY UNAVAILABLE", detail: "There is no governed media-asset storage, upload, rights, licence, or patient-image consent registry in the current backend. The generated campaign illustration is a design sample and is not an approved reusable asset.", links: [["/marketing/studio", "Open content drafts"]] },
  meta: { state: "PROVIDER DISCONNECTED", detail: "Instagram and Facebook posts, comments, insights, and publication receipts are not imported. This workspace does not scrape public pages or imply a connected Meta account.", links: [["/marketing/studio", "Prepare an internal content draft"], ["/communications/inbox", "Open the internal communications inbox"]] },
  youtube: { state: "PROVIDER DISCONNECTED", detail: "No YouTube channel, upload, schedule, video analytics, or publication result is connected. Internal copy and video plans are not uploads.", links: [["/marketing/studio", "Prepare an internal content draft"]] },
  linkedin: { state: "PROVIDER DISCONNECTED", detail: "No LinkedIn page, campaign, insight, or post is connected. Corporate relationship records do not authorize publishing or expose clinical/customer data.", links: [["/marketing/studio", "Prepare an internal content draft"], ["/relationships/corporate", "Open authorized corporate relationships"]] },
  local: { state: "PROVIDER DISCONNECTED", detail: "No Google Business location, review feed, response permission, or reputation metric is connected. No review or reply is fabricated here.", links: [["/marketing/studio", "Prepare an internal content draft"], ["/support/tickets", "Open internal support requests"]] },
  ads: { state: "AD ACCOUNTS NOT CONFIGURED", detail: "No advertising account, spend plan, approved budget ceiling, financial authorization, or verified spend source exists. This screen cannot connect, spend, pause, or modify advertising.", links: [["/finance", "Open finance workspace"], ["/marketing/campaigns", "Open internal campaign records"]] },
  website: { state: "WEBSITE CMS HANDOFF", detail: "Public website content has its own protected editorial and publication workflow. This marketing screen does not bypass its permissions, clinical review, promotion terms, or approvals.", links: [["/owner/website-content", "Open protected website content governance"], ["/offers", "View the public offers page"]] },
  seo: { state: "SEARCH ANALYTICS NOT CONNECTED", detail: "No analytics or Search Console provider is connected. Rankings, impressions, clicks, visits, and conversions are not available and are not estimated in this screen.", links: [["/owner/website-content", "Review website content"]] },
  community: { state: "EXTERNAL INTERACTIONS UNAVAILABLE", detail: "No social comments, direct messages, or reputation cases are imported. Staff must not treat these empty records as proof that no external interactions exist. Do not include patient or medical details in public replies.", links: [["/support/tickets", "Open internal support requests"], ["/communications/inbox", "Open internal communications"]] },
  governance: { state: "EXTERNAL ACCESS AND BUDGET GATES UNAVAILABLE", detail: "Current marketing permissions cover internal read/manage actions only. Platform-specific publishing, replies, exports, time-limited provider grants, campaign budgets, and spend approvals are not implemented.", links: [["/owner/roles", "Open role and permission administration"], ["/owner/audit", "Open audit activity"], ["/finance", "Open finance workspace"]] },
};

export function MarketingScreenNavigation({ current }: { current: MarketingModule }) {
  return <nav className="page-actions" aria-label="Canonical Phase 09 marketing screens">
    {canonicalMarketingScreens.map((screen) => <Link key={screen.id} aria-current={screen.module === current ? "page" : undefined} className="button button-secondary" href={screen.route}>{screen.id} · {screen.name}</Link>)}
    <Link className="button button-secondary" href="/marketing/design/m001">Synthetic design references</Link>
  </nav>;
}

export function RestrictedMarketingScreen({ module }: { module: Exclude<MarketingModule, "home" | "studio" | "calendar" | "approvals" | "publishing" | "campaigns" | "attribution"> }) {
  const screen = canonicalMarketingScreens.find((item) => item.module === module)!;
  const status = descriptions[module];
  return <>
    <MarketingScreenNavigation current={module} />
    <section className="admin-card" aria-labelledby="marketing-screen-title">
      <p><strong>{screen.id}</strong> · Canonical screen from `SCREEN_SPEC_178.md`</p>
      <h2 id="marketing-screen-title">{screen.name}</h2>
      <p role="status"><strong>{status.state}</strong></p>
      <p>{status.detail}</p>
      <p>All external metrics and provider data are unavailable. This page shows no synthetic operational records.</p>
      <div className="page-actions">{status.links.map(([href, label]) => <Link className="button button-secondary" href={href} key={href}>{label}</Link>)}</div>
      <p>Screenshot-reference previews retain their own labels and routes under `/marketing/design/m001`–`m018`; they are examples, not this screen's connected operational state.</p>
    </section>
  </>;
}
