import { AdminShell } from "@/components/admin/admin-shell";
import { SamplesDirectory } from "@/components/samples/sample-workbench";
import { Suspense } from "react";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

async function ReceivingContent({ searchParams, grants }: { searchParams: Promise<{ centreId?: string }>; grants: NonNullable<Parameters<typeof SamplesDirectory>[0]["grants"]> }) {
  const params = await searchParams;
  return <><SampleWorkflowNav current="L003" /><SamplesDirectory mode="receiving" grants={grants} initialCentreId={params.centreId} /></>;
}

export default function RudraReceivingPage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="samples.receive" title="Rudra sample receiving">{(staff) => <Suspense fallback={<section className="admin-card" role="status">Loading receiving queue…</section>}><ReceivingContent searchParams={searchParams} grants={staff.grants} /></Suspense>}</AdminShell>;
}
