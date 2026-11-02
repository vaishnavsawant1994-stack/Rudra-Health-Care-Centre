import { and, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";

export async function GET(request: Request) {
  const type = new URL(request.url).searchParams.get("type");
  if (type !== "CORPORATE" && type !== "PARTNER") return Response.json({ error: "invalid_type" }, { status: 400 });
  const permission = type === "CORPORATE" ? "corporate.read" : "partners.read";
  const access = await getApiAccess(permission); if (access.response) return access.response;
  const allowed = access.staff.grants.filter((grant) => grant.key === permission).map((grant) => grant.centreId);
  if (!allowed.includes(null) && allowed.length === 0) return Response.json({ centres: [] });
  const conditions = [eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE")];
  if (!allowed.includes(null)) conditions.push(inArray(centres.id, allowed as string[]));
  const result = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(...conditions));
  return Response.json({ centres: result });
}
