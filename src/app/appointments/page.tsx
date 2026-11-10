import { AdminShell } from "@/components/admin/admin-shell";
import { AppointmentDashboard } from "@/components/appointments/appointment-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

export default function AppointmentsPage() { return <AdminShell permission="appointments.read" title="Appointments">{(staff) => <><ReceptionWorkflowNav current="03" /><AppointmentDashboard canCreateBooking={staff.grants.some((grant) => grant.key === "appointments.create")} /></>}</AdminShell>; }
