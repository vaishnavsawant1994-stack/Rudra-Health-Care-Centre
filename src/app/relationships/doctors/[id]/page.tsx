import Link from "next/link";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { DoctorWorkbench } from "@/components/doctors/doctor-workbench";

async function DoctorProfileContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="doctors.read" title="Doctor relationship profile">{(staff) => <>
    <p><Link href="/relationships/doctors">Back to doctor directory</Link></p>
    <DoctorWorkbench grants={staff.grants} initialDoctorId={id} profileOnly />
  </>}</AdminShell>;
}

export default function DoctorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<section className="admin-card" role="status">Loading doctor profile…</section>}><DoctorProfileContent params={params} /></Suspense>;
}
