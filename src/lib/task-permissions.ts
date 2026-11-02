import type { PermissionGrant } from "@/server/permissions";

function hasCentreGrant(grants: readonly PermissionGrant[], key: string, centreId: string) {
  return grants.some((grant) => grant.key === key && (grant.centreId === null || grant.centreId === centreId));
}

export function canUpdateTask(grants: readonly PermissionGrant[], centreId: string, assignedStaffId: string, staffId: string, taskType?: string) {
  const update = hasCentreGrant(grants, "tasks.update", centreId);
  const supportManager = taskType === "SUPPORT_REQUEST" && hasCentreGrant(grants, "tasks.support.manage", centreId);
  if (supportManager) return update;
  return update && (assignedStaffId === staffId || hasCentreGrant(grants, "tasks.read", centreId));
}

export function canAssignTaskInCentre(grants: readonly PermissionGrant[], centreId: string, taskType?: string) {
  return hasCentreGrant(grants, "tasks.assign", centreId)
    || (taskType === "SUPPORT_REQUEST" && hasCentreGrant(grants, "tasks.support.manage", centreId));
}

export function canApproveTaskInCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasCentreGrant(grants, "tasks.approve", centreId);
}

export function canEscalateTaskInCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasCentreGrant(grants, "escalations.create", centreId);
}
