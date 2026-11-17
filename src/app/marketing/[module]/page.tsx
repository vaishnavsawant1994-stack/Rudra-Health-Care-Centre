import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { ContentCalendarWorkbench } from "@/components/marketing/content-calendar-workbench";
import { MarketingScreenNavigation, RestrictedMarketingScreen, canonicalMarketingScreens, type MarketingModule } from "@/components/marketing/phase09-marketing-screens";

export default function CanonicalMarketingModulePage({ params }: { params: Promise<{ module: string }> }) {
  return <Suspense fallback={<main role="status">Loading marketing workspace…</main>}><ResolvedMarketingModule params={params} /></Suspense>;
}

async function ResolvedMarketingModule({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const screen = canonicalMarketingScreens.find((item) => item.route === `/marketing/${module}`);
  if (!screen || ["home", "campaigns", "attribution"].includes(screen.module)) notFound();
  const key = screen.module as MarketingModule;
  return <AdminShell permission="marketing.read" title={screen.name}>{(staff) => <>
    {(key === "studio" || key === "calendar" || key === "approvals" || key === "publishing") ? <>
      <MarketingScreenNavigation current={key} />
      <section className="admin-card"><h2>{screen.id} · {screen.name}</h2>
        <p>{key === "publishing" ? "Scheduled entries are internal planning records only. There is no publishing adapter, provider queue, upload, retry, or external result." : "This canonical screen uses centre-scoped encrypted content drafts and the existing audited review workflow. A scheduled date is not publication."}</p>
        <ContentCalendarWorkbench initialStatus={key === "approvals" ? "IN_REVIEW" : key === "publishing" ? "SCHEDULED" : "ALL"} canManage={staff.grants.some((grant) => grant.key === "marketing.manage")} />
      </section>
    </> : <RestrictedMarketingScreen module={key as Exclude<MarketingModule, "home" | "studio" | "calendar" | "approvals" | "publishing" | "campaigns" | "attribution">} />}
  </>}</AdminShell>;
}
