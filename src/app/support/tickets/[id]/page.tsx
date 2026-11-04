import Link from "next/link";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { SupportTicketDetail } from "@/components/support/support-ticket-detail";

async function TicketDetails({ params, staffId, grants }: { params: Promise<{ id: string }>; staffId: string; grants: Array<{ key: string; centreId: string | null }> }) {
  const { id } = await params;
  return <>
    <p className="admin-card"><Link href="/support/tickets">Back to support requests</Link></p>
    <SupportTicketDetail key={id} id={id} staffId={staffId} grants={grants} />
  </>;
}

export default function SupportTicketDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  return <AdminShell permission="tasks.read" title="Support request details">{(staff) => <Suspense fallback={<section className="admin-card" role="status">Loading support request…</section>}><TicketDetails params={params} staffId={staff.staffUserId} grants={staff.grants} /></Suspense>}</AdminShell>;
}
