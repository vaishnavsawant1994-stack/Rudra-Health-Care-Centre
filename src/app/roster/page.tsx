import { AdminShell } from "@/components/admin/admin-shell";
import { RosterWorkbench } from "@/components/roster/roster-workbench";
import { Suspense } from "react";

async function RosterContent({ searchParams, staffId, grants }: { searchParams: Promise<{ centreId?: string }>; staffId: string; grants: Array<{ key: string; centreId: string | null }> }) {
  const params = await searchParams;
  return <RosterWorkbench sessionStaffId={staffId} grants={grants} initialCentreId={params.centreId} />;
}

export default function RosterPage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="roster.read" title="Staff roster">{(staff) => <Suspense fallback={<section className="admin-card" role="status">Loading staff roster…</section>}><RosterContent searchParams={searchParams} staffId={staff.staffUserId} grants={staff.grants} /></Suspense>}</AdminShell>;
}
