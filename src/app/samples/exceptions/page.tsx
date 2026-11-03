import { AdminShell } from "@/components/admin/admin-shell";
import { SamplesDirectory } from "@/components/samples/sample-workbench";
import { Suspense } from "react";

async function ExceptionsContent({ searchParams, grants }: { searchParams: Promise<{ centreId?: string }>; grants: NonNullable<Parameters<typeof SamplesDirectory>[0]["grants"]> }) {
  const params = await searchParams;
  return <SamplesDirectory mode="exceptions" grants={grants} initialCentreId={params.centreId} />;
}

export default function SampleExceptionsPage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="samples.read" title="Sample exceptions">{(staff) => <Suspense fallback={<section className="admin-card" role="status">Loading sample exceptions…</section>}><ExceptionsContent searchParams={searchParams} grants={staff.grants} /></Suspense>}</AdminShell>;
}
