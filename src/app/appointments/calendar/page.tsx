import { AdminShell } from "@/components/admin/admin-shell";
import { AppointmentCalendar } from "@/components/appointments/appointment-workbench";

export default function AppointmentCalendarPage() { return <AdminShell permission="appointments.read" title="Appointment calendar"><AppointmentCalendar /></AdminShell>; }
