import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { getRoleWorkspaceCapabilities } from "@/server/role-workspaces";

export default function FieldSupportPage() {
  return <AdminShell permission="tasks.support.create" title="Field support request">
    {(staff) => {
      const capabilities = getRoleWorkspaceCapabilities(staff.grants);
      const canRead = staff.grants.some((grant) => ["tasks.read", "tasks.assigned.read", "tasks.support.read"].includes(grant.key));
      return <>
        <p className="setup-notice">Create an internal operational request for a field issue. Do not include unnecessary patient or clinical details. This form does not send a message, call a patient, authorize a clinical decision, or change a sample status.</p>
        <p><Link className="button-link" href="/field/today">Return to my collection assignments</Link></p>
        {capabilities.createSupportTask
          ? <TaskWorkbench staffId={staff.staffUserId} permissionGrants={staff.grants} canRead={canRead} canCreate canUpdate={staff.grants.some((grant) => ["tasks.update", "tasks.support.manage"].includes(grant.key))} canApprove={false} canAssign={staff.grants.some((grant) => ["tasks.assign", "tasks.support.manage"].includes(grant.key))} canEscalate={staff.grants.some((grant) => grant.key === "escalations.create")} initialTaskType="SUPPORT_REQUEST" fixedTaskType="SUPPORT_REQUEST" />
          : <section className="admin-card" role="status"><h2>Request access is not configured</h2><p>Your account has support-request access but does not have task-creation permission in the same centre. Ask an authorized centre administrator to review your role permissions.</p></section>}
      </>;
    }}
  </AdminShell>;
}
