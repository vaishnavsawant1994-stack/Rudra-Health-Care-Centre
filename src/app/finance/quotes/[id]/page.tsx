import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceQuoteDetail } from "@/components/finance/finance-quote-detail";
import { Suspense } from "react";
type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ leadId?: string | string[] }> };
export default function QuoteReviewPage({ params, searchParams }: PageProps) {
  return <Suspense fallback={<section className="admin-card" role="status">Loading quote review…</section>}><QuoteReviewContent params={params} searchParams={searchParams} /></Suspense>;
}
async function QuoteReviewContent({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const leadId = typeof query.leadId === "string" ? query.leadId : "";
  return <AdminShell permission="finance.read" title="Internal quote details">{() => <FinanceQuoteDetail quoteId={id} leadId={leadId} />}</AdminShell>;
}
