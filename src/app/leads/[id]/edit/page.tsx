import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { LeadEditForm } from "@/components/leads/lead-workbench";

export const instant = false;
export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminShell permission="leads.update" title="Edit lead"><p className="setup-notice"><Link href={`/leads/${id}`}>Back to Lead 360°</Link></p><LeadEditForm leadId={id} /></AdminShell>; }
