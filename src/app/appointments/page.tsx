import { AdminShell } from "@/components/admin/admin-shell";
import { AppointmentDashboard } from "@/components/appointments/appointment-workbench";

export default function AppointmentsPage() { return <AdminShell permission="appointments.read" title="Appointments">{(staff) => <AppointmentDashboard canCreateBooking={staff.grants.some((grant) => grant.key === "appointments.create")} />}</AdminShell>; }
