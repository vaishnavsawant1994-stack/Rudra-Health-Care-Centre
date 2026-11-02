import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function RefundsPage(){return <AdminShell permission="finance.read" title="Refunds">{(staff)=><FinanceWorkbench mode="refunds" grants={staff.grants}/>}</AdminShell>;}
