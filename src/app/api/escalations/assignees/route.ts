import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { permissions, rolePermissions, roles, staffRoleAssignments, staffUsers } from "@/db/schema";

export async function GET(request: Request) {
  const centreId = new URL(request.url).searchParams.get("centreId");
  if (!z.uuid().safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const access = await getApiAccess("escalations.manage", centreId!);
  if (access.response) return access.response;
  const staff = await getDb().selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode })
    .from(staffUsers)
    .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
    .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), inArray(permissions.key, ["escalations.read", "escalations.assigned.read"])))
    .where(and(eq(staffUsers.organizationId, access.staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, centreId!), isNull(staffRoleAssignments.centreId))))
    .orderBy(asc(staffUsers.displayName)).limit(200);
  return Response.json({ staff });
}
