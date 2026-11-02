import { AdminShell } from "@/components/admin/admin-shell";
import { ReportWorkbench } from "@/components/reports/report-workbench";
export default function ReportsPage(){return <AdminShell permission="reports.read" title="Diagnostic reports">{staff=><ReportWorkbench mode="dashboard" grants={staff.grants} staffId={staff.staffUserId}/>}</AdminShell>;}
