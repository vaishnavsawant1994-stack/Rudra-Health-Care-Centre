import { AdminShell } from "@/components/admin/admin-shell";import { ReportWorkbench } from "@/components/reports/report-workbench";
export default function Page(){return <AdminShell permission="reports.register" title="Register report">{staff=><ReportWorkbench mode="new" grants={staff.grants} staffId={staff.staffUserId}/>}</AdminShell>;}
