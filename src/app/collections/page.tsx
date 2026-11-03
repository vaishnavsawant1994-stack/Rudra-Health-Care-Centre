import { AdminShell } from "@/components/admin/admin-shell";
import { CollectionOperations } from "@/components/samples/sample-workbench";
import { Suspense } from "react";

async function CollectionContent({ searchParams, grants }: { searchParams: Promise<{ centreId?: string }>; grants: NonNullable<Parameters<typeof CollectionOperations>[0]["grants"]> }) {
  const params = await searchParams;
  return <CollectionOperations grants={grants} initialCentreId={params.centreId} />;
}

export default function CollectionsPage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="collections.read" title="Collection operations">{(staff) => <Suspense fallback={<section className="admin-card" role="status">Loading collection operations…</section>}><CollectionContent searchParams={searchParams} grants={staff.grants} /></Suspense>}</AdminShell>;
}
