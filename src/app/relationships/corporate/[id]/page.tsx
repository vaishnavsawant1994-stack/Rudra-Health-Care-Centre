import Link from "next/link";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { BusinessRelationshipWorkbench } from "@/components/relationships/business-relationship-workbench";

async function CorporateProfileContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="corporate.read" title="Corporate relationship profile">{(staff) => {
    const grants = staff.grants.filter((grant) => grant.key === "corporate.manage");
    return <><p><Link href="/relationships/corporate">Back to corporate directory</Link></p><BusinessRelationshipWorkbench type="CORPORATE" staffId={staff.staffUserId} grants={staff.grants} manageableCentreIds={grants.flatMap((grant) => grant.centreId ? [grant.centreId] : [])} manageAllCentres={grants.some((grant) => grant.centreId === null)} initialRelationshipId={id} profileOnly /></>;
  }}</AdminShell>;
}

export default function CorporateProfilePage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<section className="admin-card" role="status">Loading corporate profile…</section>}><CorporateProfileContent params={params} /></Suspense>;
}
