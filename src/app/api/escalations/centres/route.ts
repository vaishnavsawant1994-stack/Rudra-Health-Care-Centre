import { and, asc, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres, staffEscalations } from "@/db/schema";
import { escalationReadScope } from "@/server/staff-escalation-policy";

export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view") ?? "create";
  if (view !== "create" && view !== "read") return Response.json({ error: "invalid_view" }, { status: 400 });
  if (view === "read") {
    let access = await getApiAccess("escalations.read");
    if (access.response) access = await getApiAccess("escalations.assigned.read");
    if (access.response) return access.response;
    const scope = escalationReadScope(access.staff.grants, access.staff.staffUserId);
    if (scope.allCentresBroad) {
      const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"))).orderBy(asc(centres.name));
      return Response.json({ centres: rows });
    }
    const allowedIds = new Set([...scope.broadCentres, ...scope.assignedCentres]);
    if (scope.assignedEverywhere) {
      const assigned = await getDb().selectDistinct({ centreId: staffEscalations.centreId }).from(staffEscalations).where(and(eq(staffEscalations.organizationId, access.staff.organizationId), eq(staffEscalations.assignedOwnerStaffId, access.staff.staffUserId)));
      for (const row of assigned) allowedIds.add(row.centreId);
    }
    const centreIds = [...allowedIds];
    if (!centreIds.length) return Response.json({ centres: [] });
    const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), inArray(centres.id, centreIds))).orderBy(asc(centres.name));
    return Response.json({ centres: rows });
  }
  const access = await getApiAccess("escalations.create");
  if (access.response) return access.response;
  const grants = access.staff.grants.filter((grant) => grant.key === "escalations.create");
  const scope = grants.some((grant) => grant.centreId === null) ? null : [...new Set(grants.map((grant) => grant.centreId).filter((id): id is string => id !== null))];
  if (scope?.length === 0) return Response.json({ centres: [] });
  const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), scope ? inArray(centres.id, scope) : undefined)).orderBy(asc(centres.name));
  return Response.json({ centres: rows });
}
