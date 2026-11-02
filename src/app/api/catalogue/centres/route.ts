import { and, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";
import { visibleLeadCentres } from "@/server/lead-policy";

export async function GET() {
  const access = await getApiAccess("catalogue.read");
  if (access.response) return access.response;
  const scope = visibleLeadCentres(access.staff.grants, "catalogue.read");
  if (scope !== null && !scope.length) return Response.json({ centres: [] });
  const conditions = [eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE")];
  if (scope !== null) conditions.push(inArray(centres.id, scope));
  return Response.json({ centres: await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(...conditions)) });
}
