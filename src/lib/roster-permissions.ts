import type { PermissionGrant } from "@/server/permissions";

function hasAtCentre(grants: readonly PermissionGrant[], key: string, centreId: string) {
  return grants.some((grant) => grant.key === key && (grant.centreId === null || grant.centreId === centreId));
}

export function canManageRosterInCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "roster.manage", centreId);
}

export function canAssignAppointmentsInCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "appointments.assign", centreId) && hasAtCentre(grants, "appointments.update", centreId);
}

export function canAssignCollectionsInCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "collections.assign", centreId);
}

export function canCreateEscalationInCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "escalations.create", centreId);
}
