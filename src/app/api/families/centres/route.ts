import { and, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";
import { visibleFamilyCentres } from "@/server/family-policy";

export async function GET(request: Request) {
  const purpose = new URL(request.url).searchParams.get("purpose") === "create" ? "families.create" : "families.read";
  const access = await getApiAccess(purpose);
  if (access.response) return access.response;
  const scope = visibleFamilyCentres(access.staff.grants, purpose);
  if (scope !== null && !scope.length) return Response.json({ centres: [] });
  const conditions = [eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE")];
  if (scope !== null) conditions.push(inArray(centres.id, scope));
  const result = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(...conditions));
  return Response.json({ centres: result });
}
