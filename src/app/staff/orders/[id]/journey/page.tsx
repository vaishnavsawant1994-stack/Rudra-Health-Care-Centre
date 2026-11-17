import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { OrderDetail } from "@/components/orders/order-workbench";
import { OrderCollectionHistory } from "@/components/samples/sample-workbench";
import { ReportLinkedHistory } from "@/components/reports/report-linked-history";
import { MetropolisOrderHistory } from "@/components/samples/metropolis-workbench";

export default function OperationalOrderJourneyPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<section className="admin-card" aria-busy="true">Loading order journey…</section>}><ResolvedJourney params={params} /></Suspense>;
}

async function ResolvedJourney({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <AdminShell permission="orders.read" title="Operational order journey">{(staff) => <>
    <p className="page-intro">Recorded operational history for this order. Planned or pending steps remain clearly separate from completed evidence.</p>
    <OrderDetail id={id} />
    {staff.grants.some((grant) => grant.key === "samples.read") ? <><OrderCollectionHistory orderId={id} /><MetropolisOrderHistory orderId={id} /></> : null}
    {staff.grants.some((grant) => grant.key === "reports.read") ? <ReportLinkedHistory kind="order" recordId={id} /> : null}
  </>}</AdminShell>;
}
