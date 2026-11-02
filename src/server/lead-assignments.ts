import { and, eq, isNull, or } from "drizzle-orm";
import type { getDb } from "@/db/client";
import { centres, roles, staffRoleAssignments, staffUsers } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

export async function isAssignableStaff(db: Db, staffId: string, organizationId: string, centreId: string) {
  const rows = await db.select({ id: staffUsers.id }).from(staffUsers)
    .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), isNull(staffRoleAssignments.revokedAt)))
    .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId))
    .innerJoin(centres, and(eq(centres.id, centreId), eq(centres.organizationId, organizationId), eq(centres.status, "ACTIVE")))
    .where(and(eq(staffUsers.id, staffId), eq(staffUsers.organizationId, organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
  return rows.length > 0;
}
