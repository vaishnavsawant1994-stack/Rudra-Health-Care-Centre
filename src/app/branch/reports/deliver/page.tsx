import { AdminShell } from "@/components/admin/admin-shell";
import { ReportWorkbench } from "@/components/reports/report-workbench";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

export default function BranchReportDeliveryPage() { return <AdminShell permission="reports.read" title="Report availability & delivery">{(staff) => <><SampleWorkflowNav current="L014"/><section className="admin-card"><p>Only clean, verified, separately approved reports are eligible for the existing staff-mediated physical handoff. Electronic delivery is disabled because recipient verification, channel authorization and provider delivery are not configured.</p></section><ReportWorkbench mode="delivery" grants={staff.grants} staffId={staff.staffUserId}/></>}</AdminShell>; }
