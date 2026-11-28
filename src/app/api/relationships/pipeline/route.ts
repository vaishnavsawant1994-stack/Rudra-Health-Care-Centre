import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";

const modules = [
  { name: "doctors", permission: "doctors.read", table: "doctor_profiles" },
  { name: "corporate", permission: "corporate.read", table: "business_relationships", type: "CORPORATE" },
  { name: "partners", permission: "partners.read", table: "business_relationships", type: "PARTNER" },
] as const;
type Rows<T> = { rows?: T[] };
const rows = <T,>(result: unknown) => (result as Rows<T>).rows ?? [];

export async function GET(request: Request) {
  const rawCentre = new URL(request.url).searchParams.get("centreId");
  const parsed = rawCentre === null ? null : z.uuid().safeParse(rawCentre);
  if (parsed && !parsed.success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const centreId = parsed?.data;
  const allowed = [];
  for (const relationModule of modules) {
    const access = await getApiAccess(relationModule.permission, centreId);
    if (!access.response) allowed.push({ ...relationModule, staff: access.staff });
  }
  if (!allowed.length) return Response.json({ error: "forbidden" }, { status: 403 });
  const organizationId = allowed[0].staff.organizationId;
  const data: Record<string, Array<{ status: string; category?: string; count: number }>> = {};
  try {
    for (const relationModule of allowed) {
      if (relationModule.staff.organizationId !== organizationId) continue;
      const grants = relationModule.staff.grants.filter(grant => grant.key === relationModule.permission);
      const allCentres = grants.some(grant => grant.centreId === null);
      const centreIds = [...new Set(grants.flatMap(grant => grant.centreId ? [grant.centreId] : []))];
      if (!centreId && !allCentres && !centreIds.length) { data[relationModule.name] = []; continue; }
      const scope = centreId ? sql`AND centre_id=${centreId}::uuid` : allCentres ? sql`` : sql`AND centre_id=ANY(ARRAY[${sql.join(centreIds.map(id => sql`${id}::uuid`), sql`, `)}])`;
      const typeFilter = "type" in relationModule ? sql`AND relationship_type=${relationModule.type}` : sql``;
      const result = rows<{ status: string; category: string | null; count: number }>(await getDb().execute(sql`SELECT status, ${"type" in relationModule ? sql`category` : sql`NULL::text AS category`}, count(*)::int AS count FROM ${sql.raw(relationModule.table)} WHERE organization_id=${organizationId} ${scope} ${typeFilter} GROUP BY status ${"type" in relationModule ? sql`, category` : sql``} ORDER BY status`));
      data[relationModule.name] = result.map(row => ({ status: row.status, ...(row.category ? { category: row.category } : {}), count: row.count }));
    }
    return Response.json({ relationships: data, contractStages: "UNAVAILABLE_PENDING_APPROVED_CONTRACT_WORKFLOW" }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "relationship_pipeline_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
