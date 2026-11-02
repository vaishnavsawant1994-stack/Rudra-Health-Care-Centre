import type { PermissionGrant } from "@/server/permissions";

export function mayManageWalkInQueueAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return grants.some((grant) => grant.key === "appointments.update" && (grant.centreId === null || grant.centreId === centreId));
}
