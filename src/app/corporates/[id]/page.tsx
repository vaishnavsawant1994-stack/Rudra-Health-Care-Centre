import Link from "next/link";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { BusinessRelationshipWorkbench } from "@/components/relationships/business-relationship-workbench";
export default function Corporate360Page({ params }: { params: Promise<{ id: string }> }) { return <Suspense fallback={<section className="admin-card" role="status">Loading corporate account…</section>}><Corporate360Content params={params} /></Suspense>; }
async function Corporate360Content({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminShell permission="corporate.read" title="Corporate account 360">{staff => { const manage = staff.grants.filter(grant => grant.key === "corporate.manage"); return <><p><Link href="/corporates">Back to corporate accounts</Link></p><BusinessRelationshipWorkbench type="CORPORATE" staffId={staff.staffUserId} grants={staff.grants} manageableCentreIds={manage.flatMap(grant => grant.centreId ? [grant.centreId] : [])} manageAllCentres={manage.some(grant => grant.centreId === null)} initialRelationshipId={id} profileOnly /></>; }}</AdminShell>; }
