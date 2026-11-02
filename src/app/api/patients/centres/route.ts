import { and, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";
import { visiblePatientCentres } from "@/server/patient-policy";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const permission = url.searchParams.get("purpose") === "read" ? "patients.read" : "patients.create";
  const access = await getApiAccess(permission);
  if (access.response) return access.response;
  const scope = visiblePatientCentres(access.staff.grants, permission);
  if (scope !== null && scope.length === 0) return Response.json({ centres: [] });
  const where = scope === null
    ? and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"))
    : and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), inArray(centres.id, scope));
  const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(where);
  return Response.json({ centres: rows });
}
