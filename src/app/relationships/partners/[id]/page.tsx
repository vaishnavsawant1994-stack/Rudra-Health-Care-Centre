import Link from "next/link";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { BusinessRelationshipWorkbench } from "@/components/relationships/business-relationship-workbench";

async function PartnerProfileContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="partners.read" title="Partner relationship profile">{(staff) => {
    const grants = staff.grants.filter((grant) => grant.key === "partners.manage");
    return <><p><Link href="/relationships/partners">Back to partner directory</Link></p><BusinessRelationshipWorkbench type="PARTNER" staffId={staff.staffUserId} grants={staff.grants} manageableCentreIds={grants.flatMap((grant) => grant.centreId ? [grant.centreId] : [])} manageAllCentres={grants.some((grant) => grant.centreId === null)} initialRelationshipId={id} profileOnly /></>;
  }}</AdminShell>;
}

export default function PartnerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<section className="admin-card" role="status">Loading partner profile…</section>}><PartnerProfileContent params={params} /></Suspense>;
}
