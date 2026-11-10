import { RudraServiceDetailPage } from "@/components/public/rudra-reference-pages";
import { PublicCatalogueDetail } from "@/components/catalogue/public-catalogue-detail";
import { getPublicCatalogueItem } from "@/server/public-catalogue";
import { Suspense } from "react";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
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
  if (["cbc", "hba1c", "thyroid", "lft", "kft", "lipid"].includes(id)) return <RudraServiceDetailPage type="TEST" id={id} />;
  return <div className="inner-page"><PublicCatalogueDetail id={id} serviceType="TEST"/></div>;
}

export default function TestDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Loading diagnostic test details…</p>}><TestDetailsContent params={params}/></Suspense>;
}
