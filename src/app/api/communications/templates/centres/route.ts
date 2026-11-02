import { and, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";
import { visibleLeadCentres } from "@/server/lead-policy";

export async function GET() {
  const permission = "leads.followups.manage";
  const access = await getApiAccess(permission);
  if (access.response) return access.response;
  const scope = visibleLeadCentres(access.staff.grants, permission);
  if (scope !== null && !scope.length) return Response.json({ centres: [] });
  const conditions = [eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE")];
  if (scope !== null) conditions.push(inArray(centres.id, scope));
  const result = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(...conditions));
  return Response.json({ centres: result }, { headers: { "cache-control": "private, no-store" } });
}
