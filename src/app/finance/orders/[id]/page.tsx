import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceRelatedHistory } from "@/components/finance/finance-workbench";
import { OrderBillingSnapshot } from "@/components/finance/order-billing-snapshot";
export const instant=false;
export default async function OrderBillingPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <AdminShell permission="finance.read" title="Order billing details"><OrderBillingSnapshot orderId={id}/><FinanceRelatedHistory kind="order" id={id}/></AdminShell>;}
