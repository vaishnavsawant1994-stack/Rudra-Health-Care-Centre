import { Suspense } from "react";
import { notFound } from "next/navigation";
import { MarketingReferenceWorkspace } from "@/components/marketing/marketing-reference-workspace";

export default function MarketingLocalPreview({ params }: { params: Promise<{ screen: string }> }) {
  return <Suspense fallback={<main role="status">Loading marketing preview…</main>}><MarketingLocalPreviewContent params={params}/></Suspense>;
}

async function MarketingLocalPreviewContent({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!/^m0(?:0[1-9]|1[01])$/i.test(screen)) notFound();
  return <MarketingReferenceWorkspace screen={screen}/>;
}
