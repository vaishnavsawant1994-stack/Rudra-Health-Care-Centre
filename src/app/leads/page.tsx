import { AdminShell } from "@/components/admin/admin-shell";
import { LeadsDirectory } from "@/components/leads/lead-workbench";

export default function LeadsPage() { return <AdminShell permission="leads.read" title="Leads & CRM"><LeadsDirectory /></AdminShell>; }
