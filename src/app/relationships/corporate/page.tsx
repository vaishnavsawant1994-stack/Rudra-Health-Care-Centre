import { AdminShell } from "@/components/admin/admin-shell";
import { BusinessRelationshipWorkbench } from "@/components/relationships/business-relationship-workbench";

export default function CorporateRelationshipsPage() { return <AdminShell permission="corporate.read" title="Corporate relationships">{(staff) => { const grants = staff.grants.filter((grant) => grant.key === "corporate.manage"); return <BusinessRelationshipWorkbench type="CORPORATE" staffId={staff.staffUserId} grants={staff.grants} manageableCentreIds={grants.flatMap((grant) => grant.centreId ? [grant.centreId] : [])} manageAllCentres={grants.some((grant) => grant.centreId === null)} />; }}</AdminShell>; }
