import { AdminShell } from "@/components/admin/admin-shell";
import { CataloguePriceReview } from "@/components/catalogue/catalogue-workbench";

export default function CataloguePricesPage() {
  return <AdminShell permission="catalogue.price.verify" title="Catalogue price review"><CataloguePriceReview /></AdminShell>;
}
