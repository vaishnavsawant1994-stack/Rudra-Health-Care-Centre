import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function OutstandingPage(){return <AdminShell permission="finance.read" title="Outstanding balances">{(staff)=><FinanceWorkbench mode="outstanding" grants={staff.grants}/>}</AdminShell>;}
