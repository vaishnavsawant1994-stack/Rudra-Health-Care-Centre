import { AdminShell } from "@/components/admin/admin-shell";
import { OrderDirectory } from "@/components/orders/order-workbench";
import { Suspense } from "react";

async function OrdersContent({ searchParams, canCreate }: { searchParams: Promise<{ centreId?: string }>; canCreate: boolean }) {
  const params = await searchParams;
  return <OrderDirectory initialCentreId={params.centreId} canCreate={canCreate} />;
}

export default function OrdersPage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="orders.read" title="Diagnostic orders">{(staff) => <Suspense fallback={<section className="admin-card" role="status">Loading diagnostic orders…</section>}><OrdersContent searchParams={searchParams} canCreate={staff.grants.some((grant) => grant.key === "orders.create")} /></Suspense>}</AdminShell>;
}
