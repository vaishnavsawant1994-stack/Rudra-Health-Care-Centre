import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
import { LeadAnalytics } from "@/components/leads/lead-analytics";

export default function BusinessAnalyticsPage() {
  return <AdminShell permission="organization.read" title="Growth and revenue intelligence">{(staff) => <>
    <p className="admin-card">O014 · CRM attribution and finance records below remain separate. Revenue is shown only to finance-authorized staff from finance records; lead conversion is not revenue.</p>
    {staff.grants.some((grant) => grant.key === "leads.read") ? <section className="workspace-operations"><h2>CRM acquisition and conversion records</h2><LeadAnalytics /></section> : <p className="admin-card">CRM analytics unavailable: leads.read is not granted.</p>}
    {staff.grants.some((grant) => grant.key === "finance.read") ? <section className="workspace-operations"><h2>Finance records</h2><FinanceWorkbench mode="dashboard" grants={staff.grants} /></section> : <p className="admin-card">Finance metrics unavailable: finance.read is not granted.</p>}
    <section className="admin-card"><h2>Attribution and external data limits</h2><p>External advertising spend, verified provider conversions and future revenue are not available in this workspace. Do not infer ROI from lead counts.</p><Link href="/owner/analytics">Open operational analytics</Link></section>
  </>}</AdminShell>;
}
