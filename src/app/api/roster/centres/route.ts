import { and, asc, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";

export async function GET() {
  const managed = await getApiAccess("roster.manage");
  const rosterRead = managed.response ? await getApiAccess("roster.read") : managed;
  const access = rosterRead.response ? await getApiAccess("roster.handover") : rosterRead;
  if (access.response) return access.response;
  const grants = access.staff.grants.filter((grant) => grant.key === "roster.manage" || grant.key === "roster.read" || grant.key === "roster.handover");
  const scope = grants.some((grant) => grant.centreId === null) ? null : [...new Set(grants.map((grant) => grant.centreId).filter((id): id is string => id !== null))];
  if (scope?.length === 0) return Response.json({ centres: [] });
  const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name, timeZone: centres.timeZone }).from(centres).where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), scope ? inArray(centres.id, scope) : undefined)).orderBy(asc(centres.name));
  return Response.json({ centres: rows });
}
