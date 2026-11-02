import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { PatientEditForm } from "@/components/patients/patient-workbench";

export const instant = false;

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="patients.update" title="Edit patient"><p className="setup-notice"><Link href={`/patients/${id}`}>Back to Patient 360°</Link></p><PatientEditForm patientId={id} /></AdminShell>;
}
