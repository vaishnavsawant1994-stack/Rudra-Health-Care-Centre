import { AdminShell } from "@/components/admin/admin-shell";
import { SamplesDirectory } from "@/components/samples/sample-workbench";
import { Suspense } from "react";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

async function ExceptionsContent({ searchParams, grants }: { searchParams: Promise<{ centreId?: string; exceptionId?: string }>; grants: NonNullable<Parameters<typeof SamplesDirectory>[0]["grants"]> }) {
  const params = await searchParams;
  return <><SampleWorkflowNav current="L004" /><SamplesDirectory mode="exceptions" grants={grants} initialCentreId={params.centreId} initialExceptionId={params.exceptionId} /></>;
}

export default function SampleExceptionsPage({ searchParams }: { searchParams: Promise<{ centreId?: string; exceptionId?: string }> }) {
  return <AdminShell permission="samples.read" title="Sample exceptions">{(staff) => <Suspense fallback={<section className="admin-card" role="status">Loading sample exceptions…</section>}><ExceptionsContent searchParams={searchParams} grants={staff.grants} /></Suspense>}</AdminShell>;
}
