import { AdminShell } from "@/components/admin/admin-shell";
import { CatalogueImport } from "@/components/catalogue/catalogue-workbench";

export default function CatalogueImportPage() {
  return <AdminShell permission="catalogue.import" title="Catalogue import"><CatalogueImport /></AdminShell>;
}
