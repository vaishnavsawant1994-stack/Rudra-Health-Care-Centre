import type { PermissionGrant } from "@/server/permissions";

export type AssignmentVisibility = {
  readCentres: string[] | null;
  restricted: boolean;
  unrestrictedCentres: string[] | null;
  assignedOnlyCentres: string[] | null;
};

/** Calculate per-centre visibility for staff who can read work and may manage assignment in only some centres. */
export function assignmentVisibility(
  grants: readonly PermissionGrant[],
  readPermission: string,
  assignPermission: string,
  assignedOnlyPermission: string | readonly string[],
): AssignmentVisibility {
  const readScopes = grants.filter((grant) => grant.key === readPermission).map((grant) => grant.centreId);
  const assignScopes = grants.filter((grant) => grant.key === assignPermission).map((grant) => grant.centreId);
  const readCentres = readScopes.includes(null) ? null : readScopes.filter((id): id is string => id !== null);
  const organizationAssignment = assignScopes.includes(null);

  const assignedOnlyPermissions = typeof assignedOnlyPermission === "string" ? [assignedOnlyPermission] : assignedOnlyPermission;
  if (!grants.some((grant) => assignedOnlyPermissions.includes(grant.key)) || organizationAssignment) {
    return { readCentres, restricted: false, unrestrictedCentres: null, assignedOnlyCentres: [] };
  }

  const assignedCentres = assignScopes.filter((id): id is string => id !== null);
  if (readCentres === null) {
    return { readCentres, restricted: true, unrestrictedCentres: assignedCentres, assignedOnlyCentres: null };
  }

  return {
    readCentres,
    restricted: true,
    unrestrictedCentres: readCentres.filter((id) => assignedCentres.includes(id)),
    assignedOnlyCentres: readCentres.filter((id) => !assignedCentres.includes(id)),
  };
}

export function assignmentVisibilityAtCentre(visibility: AssignmentVisibility, centreId: string): "all" | "assigned" | "none" {
  if (visibility.readCentres !== null && !visibility.readCentres.includes(centreId)) return "none";
  if (!visibility.restricted || visibility.unrestrictedCentres === null || visibility.unrestrictedCentres.includes(centreId)) return "all";
  if (visibility.assignedOnlyCentres === null || visibility.assignedOnlyCentres.includes(centreId)) return "assigned";
  return "none";
}
