import { AdminShell } from "@/components/admin/admin-shell";
import { EscalationWorkbench } from "@/components/escalations/escalation-workbench";

export default function EscalationsPage() {
  return <AdminShell permission="workspace.read" title="Operational escalations">{(staff) => {
    const canRead = staff.grants.some((grant) => ["escalations.read", "escalations.assigned.read"].includes(grant.key));
    if (!canRead) return <section className="admin-card"><h2>Access restricted</h2><p>Your current role cannot view operational escalations.</p></section>;
    return <EscalationWorkbench staffId={staff.staffUserId} grants={staff.grants} canCreate={staff.grants.some((grant) => grant.key === "escalations.create")} canRead={staff.grants.some((grant) => ["escalations.read", "escalations.assigned.read"].includes(grant.key))} canAssign={staff.grants.some((grant) => grant.key === "escalations.manage")} />;
  }}</AdminShell>;
}
