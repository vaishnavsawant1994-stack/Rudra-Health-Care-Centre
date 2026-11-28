import { AdminShell } from "@/components/admin/admin-shell";
import { FinancePhase06Screen } from "@/components/finance/phase-06-screen";
import { Suspense } from "react";
export default function InvoiceRecordPage({ params }: { params: Promise<{ id: string }> }) { return <Suspense fallback={<section className="admin-card" role="status">Loading invoice record…</section>}><InvoiceRecordContent params={params} /></Suspense>; }
async function InvoiceRecordContent({ params }: { params: Promise<{ id: string }> }) { await params; return <AdminShell permission="finance.read" title="Invoice and receipt records">{() => <FinancePhase06Screen screen="invoice" />}</AdminShell>; }
