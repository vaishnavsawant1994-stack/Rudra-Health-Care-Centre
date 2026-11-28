import { AdminShell } from "@/components/admin/admin-shell";
import { ReportWorkbench } from "@/components/reports/report-workbench";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

export default function BranchReportExceptionsPage() { return <AdminShell permission="reports.read" title="Report corrections & revocations">{(staff) => <><SampleWorkflowNav current="L015"/><section className="admin-card"><p>Corrections create a new report version and preserve the superseded record and audit trail. Patient access remains disabled pending identity proofing. Delivery re-notification is not sent automatically.</p></section><ReportWorkbench mode="exceptions" grants={staff.grants} staffId={staff.staffUserId}/></>}</AdminShell>; }
