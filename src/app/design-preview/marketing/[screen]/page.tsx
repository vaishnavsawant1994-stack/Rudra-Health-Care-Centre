import { Suspense } from "react";
import { notFound } from "next/navigation";
import { MarketingReferenceWorkspace } from "@/components/marketing/marketing-reference-workspace";
import { Phase09OperationsReference } from "@/components/marketing/phase09-operations-reference";

export default function MarketingLocalPreview({ params }: { params: Promise<{ screen: string }> }) {
  return <Suspense fallback={<main role="status">Loading marketing preview…</main>}><MarketingLocalPreviewContent params={params}/></Suspense>;
}

async function MarketingLocalPreviewContent({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!/^m0(?:0[1-9]|1[0-8])$/i.test(screen)) notFound();
  return screen.toLowerCase() >= "m012" ? <Phase09OperationsReference screen={screen} local/> : <MarketingReferenceWorkspace screen={screen}/>;
}
