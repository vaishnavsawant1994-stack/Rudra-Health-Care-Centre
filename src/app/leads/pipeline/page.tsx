import { AdminShell } from "@/components/admin/admin-shell";
import { LeadPipelineBoard } from "@/components/leads/lead-workbench";

export default function LeadPipelinePage() { return <AdminShell permission="leads.read" title="CRM pipeline"><LeadPipelineBoard /></AdminShell>; }
