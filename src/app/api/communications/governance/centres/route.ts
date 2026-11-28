import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";
import { getApiAccess } from "@/server/access";
import { hasPermission } from "@/server/permissions";

export async function GET() {
  const access = await getApiAccess("configuration.read");
  if (access.response) return access.response;
  const grants = access.staff.grants.filter((grant) => grant.key === "configuration.read");
  if (!grants.length) return Response.json({ centres: [] }, { headers: { "cache-control": "private, no-store" } });
  const centreScope = grants.some((grant) => grant.centreId === null) ? null : grants.map((grant) => grant.centreId).filter((id): id is string => Boolean(id));
  const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(
    eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"),
    centreScope === null ? undefined : inArray(centres.id, centreScope),
  ));
  return Response.json({ centres: rows.filter((centre) => hasPermission(access.staff.grants, "configuration.read", centre.id)) }, { headers: { "cache-control": "private, no-store" } });
}
