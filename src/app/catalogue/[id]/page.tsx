import { AdminShell } from "@/components/admin/admin-shell";
import { CatalogueItemDetail, CataloguePublicationManager } from "@/components/catalogue/catalogue-workbench";

export const instant = false;

export default async function CatalogueItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="catalogue.read" title="Catalogue item">{(staff) => <><CatalogueItemDetail id={id} canManage={staff.grants.some((grant) => grant.key === "catalogue.manage")} />{staff.grants.some((grant) => grant.key === "catalogue.manage") && <CataloguePublicationManager id={id} />}</>}</AdminShell>;
}
