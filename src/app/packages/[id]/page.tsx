import { RudraServiceDetailPage } from "@/components/public/rudra-reference-pages";
import { PublicCatalogueDetail } from "@/components/catalogue/public-catalogue-detail";
import { getPublicCatalogueItem } from "@/server/public-catalogue";
import { Suspense } from "react";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
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
  if (["full-body", "diabetes-care", "thyroid-profile", "heart-health", "women-health", "senior-care", "child-health"].includes(id)) return <RudraServiceDetailPage type="PACKAGE" id={id} />;
  return <div className="inner-page"><PublicCatalogueDetail id={id} serviceType="PACKAGE"/></div>;
}

export default function PackageDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Loading diagnostic package details…</p>}><PackageDetailsContent params={params}/></Suspense>;
}
