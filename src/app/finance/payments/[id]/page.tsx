import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export const instant=false;
export default async function PaymentDetailsPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <AdminShell permission="finance.read" title="Payment details and history">{(staff)=><FinanceWorkbench mode="payments" selectedPaymentId={id} grants={staff.grants}/>}</AdminShell>;}
