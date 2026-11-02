import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function FinancialExceptionsPage(){return <AdminShell permission="finance.read" title="Financial exceptions">{(staff)=><FinanceWorkbench mode="exceptions" grants={staff.grants}/>}</AdminShell>;}
