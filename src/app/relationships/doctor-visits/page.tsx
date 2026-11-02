import { AdminShell } from "@/components/admin/admin-shell";
import { DoctorVisitWorkbench } from "@/components/doctor-visits/doctor-visit-workbench";

export default function DoctorVisitsPage() {
  return <AdminShell permission="doctors.manage" title="Doctor Visit Plan & Field Log">{(staff) => <DoctorVisitWorkbench grants={staff.grants} />}</AdminShell>;
}
