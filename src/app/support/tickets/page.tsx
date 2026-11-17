import { AdminShell } from "@/components/admin/admin-shell";
import { SupportTicketQueue } from "@/components/support/support-ticket-queue";
import { Phase08RouteNavigation } from "@/components/communications/phase08-route-support";
import Link from "next/link";
import { Suspense } from "react";

async function Queue({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  const params = await searchParams;
  return <SupportTicketQueue initialCentreId={params.centreId} />;
}

export default function SupportTicketsPage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="tasks.read" title="Support request queue">{(staff) => <>
    <Phase08RouteNavigation current="A006" />
    {staff.grants.some((grant) => grant.key === "tasks.support.create") && <p className="page-actions"><Link className="button-link" href="/field/support">Create internal support request</Link></p>}
    <Suspense fallback={<section className="admin-card" role="status">Loading support requests...</section>}><Queue searchParams={searchParams} /></Suspense>
  </>}
  </AdminShell>;
}
