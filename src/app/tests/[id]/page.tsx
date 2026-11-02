import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTitle } from "@/components/ui/page-title";
import { PublicCatalogueDetail } from "@/components/catalogue/public-catalogue-detail";
import { getPublicCatalogueItem } from "@/server/public-catalogue";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const item = await getPublicCatalogueItem(id);
    if (!item || item.serviceType !== "TEST") return { title: "Diagnostic test details", robots: { index: false, follow: false } };
    return { title: `${item.displayName} | Diagnostic test`, description: `Published diagnostic test details at ${item.centreName}. Service and price information is subject to current verification; a listing does not confirm availability.` };
  } catch {
    return { title: "Diagnostic test details", robots: { index: false, follow: false } };
  }
}

async function TestDetailsContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <><PageTitle eyebrow="Verified catalogue" title="Test details" description="Current published details are loaded from Rudra’s verified catalogue."/><PublicCatalogueDetail id={id} serviceType="TEST"/></>;
}

export default function TestDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  return <div className="inner-page"><Suspense fallback={<p role="status">Loading catalogue details…</p>}><TestDetailsContent params={params}/></Suspense></div>;
}
