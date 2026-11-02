import { AdminShell } from "@/components/admin/admin-shell";
import { PatientList } from "@/components/patients/patient-workbench";

export default function PatientsPage() {
  return <AdminShell permission="patients.read" title="Patient records">{(staff) => <PatientList canCreate={staff.grants.some((grant) => grant.key === "patients.create")} />}</AdminShell>;
}
