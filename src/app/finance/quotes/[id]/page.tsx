import { AdminShell } from "@/components/admin/admin-shell";
import { FinancePhase06Screen } from "@/components/finance/phase-06-screen";
import { Suspense } from "react";
export default function QuoteReviewPage({ params }: { params: Promise<{ id: string }> }) { return <Suspense fallback={<section className="admin-card" role="status">Loading quote review…</section>}><QuoteReviewContent params={params} /></Suspense>; }
async function QuoteReviewContent({ params }: { params: Promise<{ id: string }> }) { await params; return <AdminShell permission="finance.read" title="Quotes and charge review">{() => <FinancePhase06Screen screen="quotes" />}</AdminShell>; }
