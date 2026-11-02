import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTitle } from "@/components/ui/page-title";
import { PublicCatalogueDetail } from "@/components/catalogue/public-catalogue-detail";
import { getPublicCatalogueItem } from "@/server/public-catalogue";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const item = await getPublicCatalogueItem(id);
    if (!item || item.serviceType !== "PACKAGE") return { title: "Diagnostic package details", robots: { index: false, follow: false } };
    return { title: `${item.displayName} | Diagnostic package`, description: `Published diagnostic package details at ${item.centreName}. Service and price information is subject to current verification; a listing does not confirm availability.` };
  } catch {
    return { title: "Diagnostic package details", robots: { index: false, follow: false } };
  }
}

async function PackageDetailsContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <><PageTitle eyebrow="Verified catalogue" title="Package details" description="Current published details and eligible included tests are loaded from Rudra’s verified catalogue."/><PublicCatalogueDetail id={id} serviceType="PACKAGE"/></>;
}

export default function PackageDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  return <div className="inner-page"><Suspense fallback={<p role="status">Loading catalogue details…</p>}><PackageDetailsContent params={params}/></Suspense></div>;
}
