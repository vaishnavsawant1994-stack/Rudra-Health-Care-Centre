import { AdminShell } from "@/components/admin/admin-shell";
import { DispatchDesk } from "@/components/samples/sample-workbench";
import { Suspense } from "react";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

async function DispatchContent({ searchParams, grants }: { searchParams: Promise<{ centreId?: string }>; grants: NonNullable<Parameters<typeof DispatchDesk>[0]["grants"]> }) {
  const params = await searchParams;
  return <><SampleWorkflowNav current="L005" /><DispatchDesk grants={grants} initialCentreId={params.centreId} /></>;
}

export default function DispatchPage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="samples.dispatch" title="Sample packing & dispatch">{(staff) => <Suspense fallback={<section className="admin-card" role="status">Loading dispatch queue…</section>}><DispatchContent searchParams={searchParams} grants={staff.grants} /></Suspense>}</AdminShell>;
}
