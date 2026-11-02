import { AdminShell } from "@/components/admin/admin-shell";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { ApprovalDeadlineProcessor } from "@/components/tasks/approval-deadline-processor";
import Link from "next/link";
import { Suspense } from "react";

type ApprovalQueueProps = { searchParams: Promise<{ queue?: string; taskId?: string }>; staffId: string; grants: Array<{ key: string; centreId: string | null }>; canUpdate: boolean; canAssign: boolean };

async function ApprovalQueue({ searchParams, staffId, grants, canUpdate, canAssign }: ApprovalQueueProps) {
  const params = await searchParams;
  const requestedFilter = params.queue === "expiry-due" ? "APPROVAL_EXPIRY_DUE" : params.queue === "escalation-due" ? "APPROVAL_ESCALATION_DUE" : "AWAITING_APPROVAL";
  return <TaskWorkbench staffId={staffId} permissionGrants={grants} canCreate={false} canUpdate={canUpdate} canApprove canAssign={canAssign} initialFilter={requestedFilter} initialTaskId={params.taskId} />;
}

export default function TaskApprovalsPage({ searchParams }: { searchParams: Promise<{ queue?: string; taskId?: string }> }) {
  return <AdminShell permission="tasks.approve" title="Supervisor approvals">{(staff) => <><ApprovalDeadlineProcessor />{staff.grants.some((grant) => grant.key === "tasks.policy.manage") && <section className="admin-card"><h2>Approval configuration</h2><p>Configure the operational task-completion policy and optional escalation.</p><Link className="button-link" href="/tasks/approvals/policies">Manage task approval policy</Link></section>}<Suspense fallback={<section className="admin-card" role="status">Loading approval queue…</section>}><ApprovalQueue searchParams={searchParams} staffId={staff.staffUserId} grants={staff.grants} canUpdate={staff.grants.some((grant) => grant.key === "tasks.update")} canAssign={staff.grants.some((grant) => grant.key === "tasks.assign")} /></Suspense></>}</AdminShell>;
}
