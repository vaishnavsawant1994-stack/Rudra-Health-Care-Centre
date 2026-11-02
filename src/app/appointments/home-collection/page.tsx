import { AdminShell } from "@/components/admin/admin-shell";
import { AppointmentList } from "@/components/appointments/appointment-workbench";

export default function HomeCollectionPage() { return <AdminShell permission="appointments.read" title="Home collection bookings">{(staff) => <AppointmentList homeOnly canCreateBooking={staff.grants.some((grant) => grant.key === "appointments.create")} />}</AdminShell>; }
