import { AdminShell } from "@/components/admin/admin-shell";
import { ApprovalPolicyWorkbench } from "@/components/tasks/approval-policy-workbench";

export default function ApprovalPoliciesPage() {
	return <AdminShell permission="tasks.policy.manage" title="Approval policies">{(staff) => <ApprovalPolicyWorkbench sessionStaffId={staff.staffUserId} />}</AdminShell>;
}
