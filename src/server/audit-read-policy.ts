import type { PermissionGrant } from "./permissions";

export function auditCentreScope(grants: readonly PermissionGrant[], requestedCentreId?: string | null) {
  const auditGrants = grants.filter((grant) => grant.key === "audit.read");
  const organizationWide = auditGrants.some((grant) => grant.centreId === null);
  if (!organizationWide) return { allowed: false, centreIds: [] as string[] };
  if (requestedCentreId) return { allowed: true, centreIds: [requestedCentreId] };
  return { allowed: true, centreIds: null as string[] | null };
}
