import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function PaymentsPage(){return <AdminShell permission="finance.read" title="Payments">{(staff)=><FinanceWorkbench mode="payments" grants={staff.grants}/>}</AdminShell>;}
