import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { roles, staffRoleAssignments, staffUsers } from "@/db/schema";
import { z } from "zod";

export async function GET(request: Request) {
  const centreId = new URL(request.url).searchParams.get("centreId");
  if (!z.uuid().safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  let access = await getApiAccess("tasks.assign", centreId!);
  const supportManage = await getApiAccess("tasks.support.manage", centreId!);
  const supportOnly = Boolean(access.response && !supportManage.response);
  if (access.response && supportManage.response) return access.response;
  if (supportOnly) access = supportManage;
  if (!access.staff) return Response.json({ error: "forbidden" }, { status: 403 });
  const staff = await getDb().selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode }).from(staffUsers)
    .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
    .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId))
    .where(and(eq(staffUsers.organizationId, access.staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, centreId!), isNull(staffRoleAssignments.centreId)), ...(supportOnly ? [inArray(roles.key, ["customer_support", "receptionist", "centre_manager", "administrator", "owner_super_admin"])] : [])))
    .orderBy(asc(staffUsers.displayName)).limit(200);
  return Response.json({ staff });
}
