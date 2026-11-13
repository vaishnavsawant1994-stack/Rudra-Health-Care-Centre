import { PublicCatalogueDetail } from "@/components/catalogue/public-catalogue-detail";
import { getPublicCatalogueItem } from "@/server/public-catalogue";

export const instant = false;

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

export async function PackageDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className="inner-page"><PublicCatalogueDetail id={id} serviceType="PACKAGE"/></div>;
}

export default PackageDetailsPage;
