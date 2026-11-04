import { AdminShell } from "@/components/admin/admin-shell";
import { SupportTicketQueue } from "@/components/support/support-ticket-queue";
import { Suspense } from "react";

async function Queue({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  const params = await searchParams;
  return <SupportTicketQueue initialCentreId={params.centreId} />;
}

export default function SupportTicketsPage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="tasks.read" title="Support request queue">
    <Suspense fallback={<section className="admin-card" role="status">Loading support requests...</section>}><Queue searchParams={searchParams} /></Suspense>
  </AdminShell>;
}
