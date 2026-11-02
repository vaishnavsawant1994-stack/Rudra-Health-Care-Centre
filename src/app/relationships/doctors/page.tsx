import { AdminShell } from "@/components/admin/admin-shell";
import { DoctorWorkbench } from "@/components/doctors/doctor-workbench";

export default function DoctorRelationshipsPage() { return <AdminShell permission="doctors.read" title="Doctors & Referral Relationships">{(staff) => <DoctorWorkbench grants={staff.grants} />}</AdminShell>; }
