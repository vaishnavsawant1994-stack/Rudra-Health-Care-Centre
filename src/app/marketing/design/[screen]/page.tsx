import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { MarketingReferenceWorkspace } from "@/components/marketing/marketing-reference-workspace";
import { Phase09OperationsReference } from "@/components/marketing/phase09-operations-reference";
import Link from "next/link";

const validScreens = new Set(Array.from({ length: 18 }, (_, index) => `m${String(index + 1).padStart(3, "0")}`));

export default function MarketingDesignPage({ params }: { params: Promise<{ screen: string }> }) {
  return <Suspense fallback={<main role="status">Loading marketing preview…</main>}><MarketingDesignContent params={params}/></Suspense>;
}

async function MarketingDesignContent({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!validScreens.has(screen.toLowerCase())) notFound();
  return <AdminShell permission="marketing.read" title="Social media & digital marketing design preview"><section className="admin-card"><strong>Design reference only</strong><p>These screenshots use synthetic records. Some M008–M016 preview labels differ from the canonical 178-screen specification and do not define operational screen IDs or provider state.</p><Link href="/marketing">Open the canonical Phase 09 marketing dashboard</Link></section>{screen.toLowerCase() >= "m012" ? <Phase09OperationsReference screen={screen}/> : <MarketingReferenceWorkspace screen={screen}/>}</AdminShell>;
}
