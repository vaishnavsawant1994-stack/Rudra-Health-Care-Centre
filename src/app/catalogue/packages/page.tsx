import { AdminShell } from "@/components/admin/admin-shell";
import { CatalogueDirectory } from "@/components/catalogue/catalogue-workbench";

export default function PackagesCataloguePage() {
  return <AdminShell permission="catalogue.read" title="Diagnostic packages">{(staff) => <CatalogueDirectory serviceType="PACKAGE" canManage={staff.grants.some((grant) => grant.key === "catalogue.manage")} canImport={staff.grants.some((grant) => grant.key === "catalogue.import")} canVerify={staff.grants.some((grant) => grant.key === "catalogue.price.verify")} />}</AdminShell>;
}
