import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function FinancePage(){return <AdminShell permission="finance.read" title="Financial operations">{(staff)=><FinanceWorkbench mode="dashboard" grants={staff.grants}/>}</AdminShell>;}
