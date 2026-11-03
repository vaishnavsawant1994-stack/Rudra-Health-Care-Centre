import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
import { Suspense } from "react";

export default function FinancePage({ searchParams }: { searchParams: Promise<{ centreId?: string }> }) {
  return <AdminShell permission="finance.read" title="Financial operations">{(staff)=><Suspense fallback={<section className="admin-card" role="status">Loading financial operations…</section>}><FinanceContent searchParams={searchParams} grants={staff.grants} /></Suspense>}</AdminShell>;
}

async function FinanceContent({ searchParams, grants }: { searchParams: Promise<{ centreId?: string }>; grants: NonNullable<Parameters<typeof FinanceWorkbench>[0]["grants"]> }) {
  const params = await searchParams;
  return <FinanceWorkbench mode="dashboard" grants={grants} initialCentreId={params.centreId} />;
}
