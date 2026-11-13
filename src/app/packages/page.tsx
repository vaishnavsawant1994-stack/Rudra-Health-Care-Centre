import { PublicCatalogueDirectory } from "@/components/catalogue/public-catalogue-directory";

export const metadata = { title: "Health Checkup Packages" };

export default function PackagesPage() {
  return <main className="inner-page"><PublicCatalogueDirectory serviceType="PACKAGE" /></main>;
}
