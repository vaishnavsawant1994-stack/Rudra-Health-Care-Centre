import { AdminShell } from "@/components/admin/admin-shell";
import { DoctorWorkbench } from "@/components/doctors/doctor-workbench";
import Link from "next/link";

export default function DoctorRelationshipsPage() { return <AdminShell permission="doctors.read" title="Doctor CRM Directory">{(staff) => <><p><Link className="button button-secondary" href="/relationships/doctors/new">Start doctor onboarding</Link> <Link href="/relationships/design/c001">Open the C001 visual reference</Link></p><p>Active/Inactive describes the Rudra relationship record only. A profile or registration reference does not verify professional credentials.</p><DoctorWorkbench grants={staff.grants} /></>}</AdminShell>; }
