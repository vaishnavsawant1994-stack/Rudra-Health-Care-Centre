import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";
import { getApiAccess } from "@/server/access";
import { hasPermission } from "@/server/permissions";

export async function GET() {
  const access = await getApiAccess("marketing.read");
  if (access.response) return access.response;
  const scope = access.staff.grants.filter((grant) => grant.key === "marketing.read").map((grant) => grant.centreId);
  if (!scope.includes(null) && scope.length === 0) return Response.json({ centres: [] });
  const rows = await getDb().select({ id: centres.id, name: centres.name, code: centres.code }).from(centres).where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), scope.includes(null) ? undefined : inArray(centres.id, scope.filter((id): id is string => id !== null))));
  return Response.json({ centres: rows.filter((centre) => hasPermission(access.staff.grants, "marketing.read", centre.id)) }, { headers: { "cache-control": "private, no-store" } });
}
