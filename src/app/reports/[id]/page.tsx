import { AdminShell } from "@/components/admin/admin-shell";import { ReportWorkbench } from "@/components/reports/report-workbench";
export const instant=false;
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <AdminShell permission="reports.read" title="Report details">{staff=><ReportWorkbench mode="detail" reportId={id} grants={staff.grants} staffId={staff.staffUserId}/>}</AdminShell>;}
