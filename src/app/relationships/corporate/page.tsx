import { AdminShell } from "@/components/admin/admin-shell";
import { BusinessRelationshipWorkbench } from "@/components/relationships/business-relationship-workbench";
import Link from "next/link";

export default function CorporateRelationshipsPage() { return <AdminShell permission="corporate.read" title="Corporate relationships">{(staff) => { const grants = staff.grants.filter((grant) => grant.key === "corporate.manage"); return <><p><Link href="/relationships/design/c006">Open the 12 doctor, corporate and partner design references</Link></p><BusinessRelationshipWorkbench type="CORPORATE" staffId={staff.staffUserId} grants={staff.grants} manageableCentreIds={grants.flatMap((grant) => grant.centreId ? [grant.centreId] : [])} manageAllCentres={grants.some((grant) => grant.centreId === null)} /></>; }}</AdminShell>; }
