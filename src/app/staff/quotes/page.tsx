import { AdminShell } from "@/components/admin/admin-shell";
import { LeadQuoteWorkbench } from "@/components/leads/lead-quote-workbench";
import { Suspense } from "react";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

async function QuoteContent({ searchParams, grants }: { searchParams: Promise<{ leadId?: string }>; grants: Parameters<typeof LeadQuoteWorkbench>[0]["grants"] }) {
  const params = await searchParams;
  return <LeadQuoteWorkbench grants={grants} initialLeadId={params.leadId} />;
}

export default function LeadQuotesPage({ searchParams }: { searchParams: Promise<{ leadId?: string }> }) {
  return <AdminShell permission="leads.read" title="Internal quote drafts">{(staff) => <><ReceptionWorkflowNav current="09" /><Suspense fallback={<section className="admin-card" role="status">Loading quote workspace...</section>}><QuoteContent searchParams={searchParams} grants={staff.grants} /></Suspense></>}</AdminShell>;
}
