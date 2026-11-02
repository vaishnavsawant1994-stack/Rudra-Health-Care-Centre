import type { PermissionGrant } from "@/server/permissions";

const taskReadPermissions = ["tasks.read", "tasks.assigned.read", "tasks.support.read"] as const;

function hasAtCentre(grants: readonly PermissionGrant[], key: string, centreId: string) {
  return grants.some((grant) => grant.key === key && (grant.centreId === null || grant.centreId === centreId));
}

export function canCreateSupportFollowupAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "tasks.create", centreId)
    && hasAtCentre(grants, "tasks.support.create", centreId)
    && taskReadPermissions.some((permission) => hasAtCentre(grants, permission, centreId));
}

export function canCreateStaffTaskAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "tasks.create", centreId) && hasAtCentre(grants, "workspace.read", centreId);
}
