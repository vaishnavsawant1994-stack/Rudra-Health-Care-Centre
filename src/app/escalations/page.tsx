import { AdminShell } from "@/components/admin/admin-shell";
import { EscalationWorkbench } from "@/components/escalations/escalation-workbench";
import { Suspense } from "react";

async function EscalationsContent({ searchParams, staffId, grants }: { searchParams: Promise<{ centreId?: string }>; staffId: string; grants: Array<{ key: string; centreId: string | null }> }) {
  const params = await searchParams;
  const canRead = grants.some((grant) => ["escalations.read", "escalations.assigned.read"].includes(grant.key));
  if (!canRead) return <section className="admin-card"><h2>Access restricted</h2><p>Your current role cannot view operational escalations.</p></section>;
  return <EscalationWorkbench staffId={staffId} grants={grants} canCreate={grants.some((grant) => grant.key === "escalations.create")} canRead initialCentreId={params.centreId} canAssign={grants.some((grant) => grant.key === "escalations.manage")} />;
}

export default function EscalationsPage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="workspace.read" title="Operational escalations">{(staff) => {
    return <Suspense fallback={<section className="admin-card" role="status">Loading escalations…</section>}><EscalationsContent searchParams={searchParams} staffId={staff.staffUserId} grants={staff.grants} /></Suspense>;
  }}</AdminShell>;
}
