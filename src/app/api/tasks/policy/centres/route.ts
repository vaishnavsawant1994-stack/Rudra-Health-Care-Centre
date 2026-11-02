import { and, asc, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";
import { approvalPolicyCentreScope } from "@/server/staff-approval-policy";

export async function GET() {
  const access = await getApiAccess("tasks.policy.manage");
  if (access.response) return access.response;
  const scope = approvalPolicyCentreScope(access.staff.grants);
  if (scope && scope.length === 0) return Response.json({ centres: [] });
  const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name })
    .from(centres)
    .where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), scope ? inArray(centres.id, scope) : undefined))
    .orderBy(asc(centres.name));
  return Response.json({ centres: rows });
}
