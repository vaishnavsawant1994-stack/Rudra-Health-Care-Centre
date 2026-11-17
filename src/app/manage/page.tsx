import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { CentreOperationsSummary } from "@/components/branch/centre-operations-summary";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { RosterWorkbench } from "@/components/roster/roster-workbench";

export default function CentreManagerPage() {
  return <AdminShell permission="workspace.read" title="Centre manager dashboard">{(staff) => {
    const has = (key: string) => staff.grants.some((grant) => grant.key === key);
    const hasOperations = ["appointments.read", "appointments.assigned.read", "orders.read", "collections.read", "samples.read", "samples.receive", "samples.dispatch", "tasks.read", "tasks.assigned.read", "roster.read", "finance.read", "leads.read", "reports.read"].some(has);
    return <>
      <section className="admin-card"><p className="eyebrow">O002 · Live authorized records</p><p>Queues and counts below come from existing centre-scoped APIs. Unavailable capability is not estimated as zero.</p><nav aria-label="Centre management"><Link href="/manage/centres">Centres</Link> · <Link href="/manage/roster">Roster</Link> · <Link href="/actions">Action Centre</Link> · <Link href="/quality/service">Service quality</Link></nav></section>
      {hasOperations ? <section className="workspace-operations"><h2>Centre workload summary</h2><CentreOperationsSummary /></section> : <section className="admin-card"><h2>No operational summary permission</h2><p>Your account does not have an authorized operational queue in this centre.</p></section>}
      {has("roster.read") || has("roster.manage") ? <section className="workspace-operations"><h2>Staff workload</h2><RosterWorkbench sessionStaffId={staff.staffUserId} grants={staff.grants} /></section> : null}
      {has("tasks.read") || has("tasks.assigned.read") ? <section className="workspace-operations"><h2>Tasks requiring action</h2><TaskWorkbench staffId={staff.staffUserId} permissionGrants={staff.grants} canCreate={has("tasks.create")} canUpdate={has("tasks.update")} canApprove={has("tasks.approve")} canAssign={has("tasks.assign")} canEscalate={has("escalations.create")} canFilterCentre={has("tasks.read")} /></section> : null}
    </>;
  }}</AdminShell>;
}
