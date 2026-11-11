import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { MarketingReferenceWorkspace } from "@/components/marketing/marketing-reference-workspace";

const validScreens = new Set(Array.from({ length: 11 }, (_, index) => `m${String(index + 1).padStart(3, "0")}`));

export default function MarketingDesignPage({ params }: { params: Promise<{ screen: string }> }) {
  return <Suspense fallback={<main role="status">Loading marketing preview…</main>}><MarketingDesignContent params={params}/></Suspense>;
}

async function MarketingDesignContent({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!validScreens.has(screen.toLowerCase())) notFound();
  return <AdminShell permission="marketing.read" title="Social media & digital marketing design preview"><MarketingReferenceWorkspace screen={screen}/></AdminShell>;
}
