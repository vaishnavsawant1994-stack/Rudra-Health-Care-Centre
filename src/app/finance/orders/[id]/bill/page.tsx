import { AdminShell } from "@/components/admin/admin-shell";
import { OrderBillingSnapshot } from "@/components/finance/order-billing-snapshot";
import { Suspense } from "react";
export default function OrderBillPage({ params }: { params: Promise<{ id: string }> }) { return <Suspense fallback={<section className="admin-card" role="status">Loading order billing…</section>}><OrderBillContent params={params} /></Suspense>; }
async function OrderBillContent({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminShell permission="finance.read" title="Order billing snapshot">{(staff) => <OrderBillingSnapshot orderId={id} grants={staff.grants} />}</AdminShell>; }
