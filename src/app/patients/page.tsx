import { AdminShell } from "@/components/admin/admin-shell";
import { PatientList } from "@/components/patients/patient-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

export default function PatientsPage() {
  return <AdminShell permission="patients.read" title="Patient records">{(staff) => <><ReceptionWorkflowNav current="01" /><PatientList canCreate={staff.grants.some((grant) => grant.key === "patients.create")} /></>}</AdminShell>;
}
