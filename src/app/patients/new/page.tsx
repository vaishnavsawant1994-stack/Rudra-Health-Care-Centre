import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { PatientRegistrationForm } from "@/components/patients/patient-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

export const instant = false;

export default async function NewPatientPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; centreId?: string }> }) {
  const params = await searchParams;
  const continueWalkIn = params.returnTo === "WALK_IN";
  const backHref = continueWalkIn ? `/appointments/new?source=WALK_IN${params.centreId ? `&centreId=${encodeURIComponent(params.centreId)}` : ""}` : "/patients";
  return <AdminShell permission="patients.create" title="Register patient"><ReceptionWorkflowNav current="02" /><p className="setup-notice"><Link href={backHref}>Back to {continueWalkIn ? "walk-in booking" : "patient list"}</Link></p><PatientRegistrationForm initialCentreId={params.centreId} continueWalkIn={continueWalkIn} /></AdminShell>;
}
