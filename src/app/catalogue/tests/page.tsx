import { AdminShell } from "@/components/admin/admin-shell";
import { CatalogueDirectory } from "@/components/catalogue/catalogue-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

export default function TestsCataloguePage() {
  return <AdminShell permission="catalogue.read" title="Diagnostic tests">{(staff) => <><ReceptionWorkflowNav current="08" /><CatalogueDirectory serviceType="TEST" canManage={staff.grants.some((grant) => grant.key === "catalogue.manage")} canImport={staff.grants.some((grant) => grant.key === "catalogue.import")} canVerify={staff.grants.some((grant) => grant.key === "catalogue.price.verify")} /></>}</AdminShell>;
}
