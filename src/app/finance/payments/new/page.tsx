import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function RecordPaymentPage(){return <AdminShell permission="finance.read" title="Record payment">{(staff)=><FinanceWorkbench mode="record" grants={staff.grants}/>}</AdminShell>;}
