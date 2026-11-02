import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres, roles, staffRoleAssignments, staffUsers } from "@/db/schema";

export async function GET(request: Request) {
  const centreId = new URL(request.url).searchParams.get("centreId");
  if (!centreId || !z.uuid().safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const access = await getApiAccess("leads.assign", centreId);
  if (access.response) return access.response;
  const eligible = await getDb().selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode })
    .from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), isNull(staffRoleAssignments.revokedAt)))
    .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId))
    .innerJoin(centres, and(eq(centres.id, centreId), eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE")))
    .where(and(eq(staffUsers.organizationId, access.staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, centreId), isNull(staffRoleAssignments.centreId))))
    .orderBy(staffUsers.displayName).limit(100);
  return Response.json({ staff: eligible });
}
