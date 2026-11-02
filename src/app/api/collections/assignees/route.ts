import { and, eq, isNull, or } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { permissions, rolePermissions, roles, staffRoleAssignments, staffUsers } from "@/db/schema";

export async function GET(request: Request) {
  const centreId = new URL(request.url).searchParams.get("centreId");
  if (!centreId) return Response.json({ error: "centre_required" }, { status: 400 });
  const access = await getApiAccess("collections.assign", centreId); if (access.response) return access.response;
  const rows = await getDb().selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt), or(isNull(staffRoleAssignments.centreId), eq(staffRoleAssignments.centreId, centreId)))).innerJoin(roles, and(eq(roles.id, staffRoleAssignments.roleId), eq(roles.organizationId, staffRoleAssignments.organizationId))).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "collections.visit.record"))).where(and(eq(staffUsers.organizationId, access.staff.organizationId), eq(staffUsers.status, "ACTIVE")));
  return Response.json({ assignees: rows });
}
