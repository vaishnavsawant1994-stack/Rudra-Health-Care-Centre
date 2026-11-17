import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { OwnerAnalyticsWorkbench } from "@/components/owner/owner-analytics-workbench";
import { RosterWorkbench } from "@/components/roster/roster-workbench";

export default function OperationsAnalyticsPage() {
  return <AdminShell permission="organization.read" title="Productivity and operations analytics">{(staff) => <>
    <p className="admin-card">O013 · Operational counts use the existing owner analytics and centre-scoped roster APIs. Counts represent recorded events/queues, not quality-adjusted productivity, travel distance, or completed service unless the source event says so.</p>
    <OwnerAnalyticsWorkbench />
    {staff.grants.some((grant) => ["roster.read", "roster.manage"].includes(grant.key)) ? <section className="workspace-operations"><h2>Authorized staff workload</h2><RosterWorkbench sessionStaffId={staff.staffUserId} grants={staff.grants} /></section> : null}
    <section className="admin-card"><h2>Unavailable measures</h2><p>GPS route distance and estimated travel are not collected here; no route efficiency score or productivity improvement is calculated.</p><Link href="/manage/roster">Open roster workbench</Link></section>
  </>}</AdminShell>;
}
