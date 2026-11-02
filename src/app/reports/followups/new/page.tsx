import { AdminShell } from "@/components/admin/admin-shell";import { ReportWorkbench } from "@/components/reports/report-workbench";
export default function Page(){return <AdminShell permission="reports.followups.manage" title="New report follow-up">{staff=><ReportWorkbench mode="followups" grants={staff.grants} staffId={staff.staffUserId}/>}</AdminShell>;}
