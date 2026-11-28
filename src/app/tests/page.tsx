import { PublicCatalogueDirectory } from "@/components/catalogue/public-catalogue-directory";

export const metadata = { title: "Diagnostic Tests" };

export default function TestsPage() {
  return <div className="inner-page"><PublicCatalogueDirectory serviceType="TEST" /></div>;
}
