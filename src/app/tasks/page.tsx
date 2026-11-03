import { AdminShell } from "@/components/admin/admin-shell";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { canReadTaskQueue } from "@/server/role-workspaces";
import { getTaskRelationshipReferenceTypes } from "@/lib/task-reference-permissions";
import { resolveTaskWorkbenchPrefill } from "@/lib/task-workbench-prefill";
import { Suspense } from "react";

async function TaskQueue({ searchParams, staffId, grants }: { searchParams: Promise<{ taskId?: string; centreId?: string; referenceType?: string; referenceId?: string; taskType?: string }>; staffId: string; grants: Array<{ key: string; centreId: string | null }> }) {
  const params = await searchParams;
  const allowedReferenceTypes = getTaskRelationshipReferenceTypes(grants);
  const prefill = resolveTaskWorkbenchPrefill(params, grants, allowedReferenceTypes);
  return <TaskWorkbench staffId={staffId} permissionGrants={grants} canRead={canReadTaskQueue(grants)} {...prefill} initialQueueCentreId={params.centreId} canCreate={grants.some((grant) => grant.key === "tasks.create")} canUpdate={grants.some((grant) => grant.key === "tasks.update")} canApprove={grants.some((grant) => grant.key === "tasks.approve")} canAssign={grants.some((grant) => grant.key === "tasks.assign")} canEscalate={grants.some((grant) => grant.key === "escalations.create")} canFilterCentre={grants.some((grant) => grant.key === "tasks.read")} relationshipReferenceTypes={allowedReferenceTypes} />;
}

export default function TasksPage({ searchParams }: { searchParams: Promise<{ taskId?: string; centreId?: string; referenceType?: string; referenceId?: string; taskType?: string }> }) {
  return <AdminShell permission="workspace.read" title="Staff tasks">{(staff) => <Suspense fallback={<section className="admin-card" role="status">Loading task queue…</section>}><TaskQueue searchParams={searchParams} staffId={staff.staffUserId} grants={staff.grants} /></Suspense>}</AdminShell>;
}
