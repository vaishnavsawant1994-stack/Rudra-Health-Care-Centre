import { AdminShell } from "@/components/admin/admin-shell";import { ReportWorkbench } from "@/components/reports/report-workbench";
export default function Page(){return <AdminShell permission="reports.followups.manage" title="Overdue report follow-ups">{staff=><ReportWorkbench mode="overdue" grants={staff.grants} staffId={staff.staffUserId}/>}</AdminShell>;}
