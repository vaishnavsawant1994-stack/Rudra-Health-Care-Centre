import { AdminShell } from "@/components/admin/admin-shell";
import { DoctorWorkbench } from "@/components/doctors/doctor-workbench";
import Link from "next/link";

export default function DoctorRelationshipsPage() { return <AdminShell permission="doctors.read" title="Doctors & Referral Relationships">{(staff) => <><p><Link href="/relationships/design/c001">Open the 12 doctor, corporate and partner design references</Link></p><DoctorWorkbench grants={staff.grants} /></>}</AdminShell>; }
