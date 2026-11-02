import { AdminShell } from "@/components/admin/admin-shell";import { ReportWorkbench } from "@/components/reports/report-workbench";
export default function Page(){return <AdminShell permission="reports.read" title="Report verification">{staff=><ReportWorkbench mode="verification" grants={staff.grants} staffId={staff.staffUserId}/>}</AdminShell>;}
