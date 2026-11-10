import { AdminShell } from "@/components/admin/admin-shell";
import { AppointmentCalendar } from "@/components/appointments/appointment-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

export default function AppointmentCalendarPage() { return <AdminShell permission="appointments.read" title="Appointment calendar"><ReceptionWorkflowNav current="05" /><AppointmentCalendar /></AdminShell>; }
