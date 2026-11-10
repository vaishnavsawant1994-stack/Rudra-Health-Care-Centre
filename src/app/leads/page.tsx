import { AdminShell } from "@/components/admin/admin-shell";
import { LeadsDirectory } from "@/components/leads/lead-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

export default function LeadsPage() { return <AdminShell permission="leads.read" title="Leads & CRM"><ReceptionWorkflowNav current="10" /><LeadsDirectory /></AdminShell>; }
