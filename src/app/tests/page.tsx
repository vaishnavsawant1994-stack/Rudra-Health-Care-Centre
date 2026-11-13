import { PublicCatalogueDirectory } from "@/components/catalogue/public-catalogue-directory";

export const metadata = { title: "Diagnostic Tests" };

export default function TestsPage() {
  return <main className="inner-page"><PublicCatalogueDirectory serviceType="TEST" /></main>;
}
