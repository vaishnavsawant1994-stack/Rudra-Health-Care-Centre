import { AdminShell } from "@/components/admin/admin-shell";
import { BusinessRelationshipWorkbench } from "@/components/relationships/business-relationship-workbench";

export default function PartnerRelationshipsPage() { return <AdminShell permission="partners.read" title="Partner relationships">{(staff) => { const grants = staff.grants.filter((grant) => grant.key === "partners.manage"); return <BusinessRelationshipWorkbench type="PARTNER" staffId={staff.staffUserId} grants={staff.grants} manageableCentreIds={grants.flatMap((grant) => grant.centreId ? [grant.centreId] : [])} manageAllCentres={grants.some((grant) => grant.centreId === null)} />; }}</AdminShell>; }
