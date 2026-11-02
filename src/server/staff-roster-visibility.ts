import type { PermissionGrant } from "@/server/permissions";

/** Null means an organization-wide grant; an empty list grants no team-centre visibility. */
export function teamRosterCentreScope(grants: readonly PermissionGrant[]): string[] | null {
  const teamGrants = grants.filter((grant) => grant.key === "roster.manage" || grant.key === "staff.read");
  if (teamGrants.some((grant) => grant.centreId === null)) return null;
  return [...new Set(teamGrants.map((grant) => grant.centreId).filter((id): id is string => id !== null))];
}

/** Basic roster readers may see their own schedule. Team views require an explicit matching grant. */
export function canReadTeamRoster(grants: readonly PermissionGrant[], centreId: string): boolean {
  const scope = teamRosterCentreScope(grants);
  return scope === null || scope.includes(centreId);
}
