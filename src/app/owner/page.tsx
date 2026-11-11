import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminDataPanel } from "@/components/admin/admin-data-panel";
import { CentreOperationsSummary } from "@/components/branch/centre-operations-summary";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
import { LeadAnalytics } from "@/components/leads/lead-analytics";
import { ReportWorkbench } from "@/components/reports/report-workbench";
import { RosterWorkbench } from "@/components/roster/roster-workbench";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { getOwnerDashboardPanels } from "@/server/owner-dashboard";
import Link from "next/link";

export default function OwnerPage() {
  return <Suspense fallback={<main className="inner-page"><div className="page-container"><p role="status">Loading owner access…</p></div></main>}>
    <AdminShell permission="organization.read" title="Owner command centre">{(staff) => {
      const panels = getOwnerDashboardPanels(staff.grants);
      const has = (permission: string) => staff.grants.some((grant) => grant.key === permission);
      return <>
        <nav className="page-actions" aria-label="Owner design references"><Link className="button button-secondary" href="/owner/design/o001">Open owner & centre dashboard references O001–O004</Link></nav>
        <AdminDataPanel endpoint="/api/admin/organization" label="Organization status" />
        {panels.includes("operations") && <section className="workspace-operations"><h2>Cross-centre operational queues</h2><CentreOperationsSummary /></section>}
        {panels.includes("staffing") && <section className="workspace-operations"><h2>Staff coverage and workload</h2><RosterWorkbench sessionStaffId={staff.staffUserId} grants={staff.grants} /></section>}
        {panels.includes("tasks") && <section className="workspace-operations"><h2>Operational tasks and approvals</h2><TaskWorkbench staffId={staff.staffUserId} permissionGrants={staff.grants} canRead={has("tasks.read") || has("tasks.assigned.read")} canCreate={has("tasks.create")} canUpdate={has("tasks.update")} canApprove={has("tasks.approve")} canAssign={has("tasks.assign")} canEscalate={has("escalations.create")} canFilterCentre={has("tasks.read")} /></section>}
        {panels.includes("crm") && <section className="workspace-operations"><h2>CRM acquisition overview</h2><LeadAnalytics /></section>}
        {panels.includes("finance") && <section className="workspace-operations"><h2>Financial operations</h2><FinanceWorkbench mode="dashboard" grants={staff.grants} /></section>}
        {panels.includes("reports") && <section className="workspace-operations"><h2>Report follow-ups</h2><ReportWorkbench mode="followups" grants={staff.grants} staffId={staff.staffUserId} /></section>}
      </>;
    }}</AdminShell>
  </Suspense>;
}
