import { AdminShell } from "@/components/admin/admin-shell";
import { RosterWorkbench } from "@/components/roster/roster-workbench";

export default function RosterPage() {
  return <AdminShell permission="roster.read" title="Staff roster">{(staff) => <RosterWorkbench sessionStaffId={staff.staffUserId} grants={staff.grants} />}</AdminShell>;
}
