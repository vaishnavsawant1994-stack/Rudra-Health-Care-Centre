import { getApiAccess } from "@/server/access";
import { assignmentVisibility } from "@/server/assignment-visibility";
import type { PermissionGrant } from "@/server/permissions";

/**
 * Collection readers may hold either broad read permission or the narrower
 * field-visit permission. Callers must still apply assignment visibility and
 * record-centre checks before returning any collection data.
 */
export async function getCollectionReadAccess(centreId?: string) {
  const broad = await getApiAccess("collections.read", centreId);
  if (broad.response?.status !== 403) return broad;
  return getApiAccess("collections.visit.record", centreId);
}

export function collectionAssignmentVisibility(grants: readonly PermissionGrant[]) {
  // Treat the narrowly scoped visit grant as read scope for this query only.
  // assignmentVisibility then limits those centres to the caller's assignments
  // unless the caller also has collections.assign there.
  const visitReadScopes = grants
    .filter((grant) => grant.key === "collections.visit.record")
    .map((grant) => ({ ...grant, key: "collections.read" }));
  return assignmentVisibility([...grants, ...visitReadScopes], "collections.read", "collections.assign", "collections.visit.record");
}
