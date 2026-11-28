import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { DoctorWorkbench } from "@/components/doctors/doctor-workbench";
export default function DoctorOnboardingPage() { return <AdminShell permission="doctors.read" title="Doctor onboarding and credential review">{staff => <><p>Entering a doctor profile records an unverified relationship lead. Professional credentials are not verified by profile creation; verification evidence and authorization remain pending an approved review process.</p><p><Link href="/relationships/doctors">Return to Doctor CRM Directory</Link></p><DoctorWorkbench grants={staff.grants} /></>}</AdminShell>; }
