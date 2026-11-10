import { AdminShell } from "@/components/admin/admin-shell";
import { AppointmentCreateForm } from "@/components/appointments/appointment-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

export const instant = false;

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ leadId?: string; centreId?: string; source?: string }> }) { const params = await searchParams; const source = params.source === "WALK_IN" ? "WALK_IN" : "STAFF"; return <AdminShell permission="appointments.create" title={source === "WALK_IN" ? "Walk-in coordination" : "New appointment"}><ReceptionWorkflowNav current="04" /><AppointmentCreateForm leadId={params.leadId} initialCentreId={params.centreId} source={source} /></AdminShell>; }
