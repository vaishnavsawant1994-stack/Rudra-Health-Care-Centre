import { AdminShell } from "@/components/admin/admin-shell";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { getTaskRelationshipReferenceTypes } from "@/lib/task-reference-permissions";

export default function TaskEscalationsPage() {
  return <AdminShell permission="tasks.approve" title="Exception and escalation queue">{(staff) => <TaskWorkbench staffId={staff.staffUserId} permissionGrants={staff.grants} canCreate={staff.grants.some((grant) => grant.key === "tasks.create")} canUpdate={staff.grants.some((grant) => grant.key === "tasks.update")} canApprove canAssign={staff.grants.some((grant) => grant.key === "tasks.assign")} canEscalate={staff.grants.some((grant) => grant.key === "escalations.create")} relationshipReferenceTypes={getTaskRelationshipReferenceTypes(staff.grants)} initialFilter="ESCALATED" />}</AdminShell>;
}
