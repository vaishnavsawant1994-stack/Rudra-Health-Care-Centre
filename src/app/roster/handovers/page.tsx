import { AdminShell } from "@/components/admin/admin-shell";
import { ShiftHandoverWorkbench } from "@/components/roster/shift-handover-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

export default function ShiftHandoversPage() {
  return <AdminShell permission="roster.handover" title="Shift handover">{(staff) => <><ReceptionWorkflowNav current="12" /><ShiftHandoverWorkbench staffId={staff.staffUserId} /></>}</AdminShell>;
}
