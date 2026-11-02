import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { LeadDetail } from "@/components/leads/lead-workbench";

export const instant = false;
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminShell permission="leads.read" title="Lead 360°"><p className="setup-notice"><Link href="/leads">Back to leads</Link></p><LeadDetail leadId={id} /></AdminShell>; }
