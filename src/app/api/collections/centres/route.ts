import { and, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";

export async function GET() {
  const access = await getApiAccess("collections.read"); if (access.response) return access.response;
  const scope = access.staff.grants.filter((g) => g.key === "collections.read").map((g) => g.centreId);
  const where = [eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE")];
  if (!scope.includes(null)) where.push(scope.length ? inArray(centres.id, scope.filter((id): id is string => Boolean(id))) : eq(centres.id, "00000000-0000-0000-0000-000000000000"));
  const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(...where));
  return Response.json({ centres: rows });
}
