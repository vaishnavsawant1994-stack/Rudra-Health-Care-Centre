import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function ReconciliationPage(){return <AdminShell permission="finance.read" title="Centre reconciliation">{(staff)=><FinanceWorkbench mode="reconciliation" grants={staff.grants}/>}</AdminShell>;}
