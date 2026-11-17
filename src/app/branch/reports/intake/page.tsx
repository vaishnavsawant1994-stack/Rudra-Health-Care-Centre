import { AdminShell } from "@/components/admin/admin-shell";
import { ReportWorkbench } from "@/components/reports/report-workbench";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

export default function BranchReportIntakePage() { return <AdminShell permission="reports.register" title="Secure report intake">{(staff) => <><SampleWorkflowNav current="L013"/><ReportWorkbench mode="new" grants={staff.grants} staffId={staff.staffUserId}/></>}</AdminShell>; }
