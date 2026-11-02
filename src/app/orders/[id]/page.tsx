import { AdminShell } from "@/components/admin/admin-shell";
import { OrderDetail } from "@/components/orders/order-workbench";
import { OrderCollectionHistory } from "@/components/samples/sample-workbench";
import { FinanceRelatedHistory } from "@/components/finance/finance-workbench";
import Link from "next/link";
import { ReportLinkedHistory } from "@/components/reports/report-linked-history";

export const instant = false;

export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="orders.read" title="Order 360°">{(staff) => <><OrderDetail id={id} />{staff.grants.some((grant) => grant.key === "samples.read") ? <OrderCollectionHistory orderId={id} /> : null}{staff.grants.some((grant)=>grant.key==="reports.read")?<ReportLinkedHistory kind="order" recordId={id}/>:null}{staff.grants.some((grant)=>grant.key==="finance.read")?<><p className="page-actions"><Link className="button button-secondary" href={`/finance/orders/${id}`}>Open billing details</Link></p><FinanceRelatedHistory kind="order" id={id}/></>:null}</>}</AdminShell>;
}
