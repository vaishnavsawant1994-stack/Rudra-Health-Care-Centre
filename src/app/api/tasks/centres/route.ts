import { and, asc, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";
import { taskCentreReadScope } from "@/server/staff-task-policy";

export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view") ?? "create";
  if (view !== "create" && view !== "read") return Response.json({ error: "invalid_view" }, { status: 400 });
  if (view === "read") {
    const access = await getApiAccess("tasks.read");
    if (access.response) return access.response;
    const scope = taskCentreReadScope(access.staff.grants);
    if (scope?.length === 0) return Response.json({ centres: [] });
    const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), scope ? inArray(centres.id, scope) : undefined)).orderBy(asc(centres.name));
    return Response.json({ centres: rows });
  }
  const access = await getApiAccess("tasks.create");
  if (access.response) return access.response;
  const taskGrants = access.staff.grants.filter((grant) => grant.key === "tasks.create");
  const scope = taskGrants.some((grant) => grant.centreId === null) ? null : [...new Set(taskGrants.map((grant) => grant.centreId).filter((id): id is string => id !== null))];
  if (scope?.length === 0) return Response.json({ centres: [] });
  const rows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres).where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), scope ? inArray(centres.id, scope) : undefined)).orderBy(asc(centres.name));
  return Response.json({ centres: rows });
}
