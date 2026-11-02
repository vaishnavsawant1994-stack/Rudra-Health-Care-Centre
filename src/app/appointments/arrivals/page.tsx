import { AdminShell } from "@/components/admin/admin-shell";
import { AppointmentList } from "@/components/appointments/appointment-workbench";

export default function AppointmentArrivalsPage() {
  return <AdminShell permission="appointments.read" title="Today’s arrival queue">{(staff) => <AppointmentList awaitingArrival canCreateBooking={staff.grants.some((grant) => grant.key === "appointments.create")} />}</AdminShell>;
}
