import { AdminShell } from "@/components/admin/admin-shell";
import { AppointmentTeamSchedule } from "@/components/appointments/appointment-workbench";

export default function AppointmentTeamPage() { return <AdminShell permission="appointments.assign" title="Staff daily schedule"><AppointmentTeamSchedule /></AdminShell>; }
