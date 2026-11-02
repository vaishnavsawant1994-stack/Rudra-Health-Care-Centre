import { AdminShell } from "@/components/admin/admin-shell";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { ServiceQualitySummary } from "./summary";

export default function ServiceQualityPage() {
  return <AdminShell permission="tasks.support.read" title="Service quality and issue resolution">{(staff) => <><ServiceQualitySummary /><p className="admin-card">This workspace tracks operational service issues only. It does not collect satisfaction scores, perform clinical triage, or send external communications.</p><TaskWorkbench staffId={staff.staffUserId} permissionGrants={staff.grants} canCreate={staff.grants.some((grant) => grant.key === "tasks.support.create")} canUpdate={staff.grants.some((grant) => grant.key === "tasks.update" || grant.key === "tasks.support.manage")} canApprove={false} canAssign={staff.grants.some((grant) => grant.key === "tasks.assign" || grant.key === "tasks.support.manage")} canEscalate={staff.grants.some((grant) => grant.key === "escalations.create")} initialTaskType="SUPPORT_REQUEST" fixedTaskType="SUPPORT_REQUEST" /></>}</AdminShell>;
}
