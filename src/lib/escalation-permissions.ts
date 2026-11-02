import type { PermissionGrant } from "@/server/permissions";

export function canManageEscalationInCentre(grants: readonly PermissionGrant[], centreId: string) {
  return grants.some((grant) => grant.key === "escalations.manage" && (grant.centreId === null || grant.centreId === centreId));
}
