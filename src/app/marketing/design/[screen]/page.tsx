import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { MarketingReferenceWorkspace } from "@/components/marketing/marketing-reference-workspace";
import { Phase09OperationsReference } from "@/components/marketing/phase09-operations-reference";

const validScreens = new Set(Array.from({ length: 18 }, (_, index) => `m${String(index + 1).padStart(3, "0")}`));

export default function MarketingDesignPage({ params }: { params: Promise<{ screen: string }> }) {
  return <Suspense fallback={<main role="status">Loading marketing preview…</main>}><MarketingDesignContent params={params}/></Suspense>;
}

async function MarketingDesignContent({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!validScreens.has(screen.toLowerCase())) notFound();
  return <AdminShell permission="marketing.read" title="Social media & digital marketing design preview">{screen.toLowerCase() >= "m012" ? <Phase09OperationsReference screen={screen}/> : <MarketingReferenceWorkspace screen={screen}/>}</AdminShell>;
}
