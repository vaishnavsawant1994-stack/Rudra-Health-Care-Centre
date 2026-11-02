import { AdminShell } from "@/components/admin/admin-shell";
import { ShiftHandoverWorkbench } from "@/components/roster/shift-handover-workbench";

export default function ShiftHandoversPage() {
  return <AdminShell permission="roster.handover" title="Shift handover">{(staff) => <ShiftHandoverWorkbench staffId={staff.staffUserId} />}</AdminShell>;
}
