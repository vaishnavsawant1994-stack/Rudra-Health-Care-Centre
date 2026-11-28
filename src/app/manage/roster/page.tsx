import { AdminShell } from "@/components/admin/admin-shell";
import { RosterWorkbench } from "@/components/roster/roster-workbench";

export default function ManagedRosterPage() {
  return <AdminShell permission="roster.read" title="Staffing, rostering and work allocation">{(staff) => <><p className="admin-card">O005 · Assignments and workload are limited by the roster API to your authorized centres and roles.</p><RosterWorkbench sessionStaffId={staff.staffUserId} grants={staff.grants} /></>}</AdminShell>;
}
