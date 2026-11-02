import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { centres, leads } from "@/db/schema";
import { getApiAccess } from "@/server/access";
import { hasLeadCentrePermission, visibleLeadCentres } from "@/server/lead-policy";
import { conversionRate, parseAnalyticsDate, summarizeLeadAnalytics } from "@/server/lead-analytics";

function defaultRange(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 30);
  return { start, end };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const centreId = url.searchParams.get("centreId") || undefined;
  const access = await getApiAccess("leads.read", centreId);
  if (access.response) return access.response;
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const range = defaultRange();
  const from = fromRaw === null ? range.start : parseAnalyticsDate(fromRaw);
  const toDate = toRaw === null ? new Date(range.end.getTime() - 86_400_000) : parseAnalyticsDate(toRaw);
  if (!from || !toDate || from > toDate) return Response.json({ error: "invalid_date_range" }, { status: 400 });
  const end = new Date(toDate); end.setUTCDate(end.getUTCDate() + 1);
  if (end.getTime() - from.getTime() > 366 * 86_400_000) return Response.json({ error: "date_range_too_large" }, { status: 400 });
  const centresAllowed = visibleLeadCentres(access.staff.grants, "leads.read");
  if (centreId && !hasLeadCentrePermission(access.staff.grants, "leads.read", centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  const scope = centreId ? [centreId] : centresAllowed;
  if (scope?.length === 0) return Response.json({ from: from.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10), total: 0, converted: 0, conversionRate: null, bySource: [], byStatus: [], byCentre: [] }, { headers: { "cache-control": "no-store" } });
  try {
    const db = getDb();
    const centreFilter = scope ? sql`${leads.centreId} = ANY(${scope}::uuid[])` : sql`true`;
    const base = and(eq(leads.organizationId, access.staff.organizationId), centreFilter, gte(leads.createdAt, from), lt(leads.createdAt, end));
    const [totals, sourceRows, statusRows, centreRows] = await Promise.all([
      db.select({ total: count(), converted: sql<number>`count(*) filter (where ${leads.status} = 'CONVERTED')` }).from(leads).where(base),
      db.select({ key: leads.source, count: count() }).from(leads).where(base).groupBy(leads.source),
      db.select({ key: leads.status, count: count() }).from(leads).where(base).groupBy(leads.status),
      db.select({ id: centres.id, name: centres.name, count: count() }).from(leads).innerJoin(centres, and(eq(centres.id, leads.centreId), eq(centres.organizationId, leads.organizationId))).where(and(base, eq(centres.status, "ACTIVE"))).groupBy(centres.id, centres.name),
    ]);
    const total = Number(totals[0]?.total ?? 0); const converted = Number(totals[0]?.converted ?? 0);
    return Response.json({ from: from.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10), total, converted, conversionRate: conversionRate(total, converted), bySource: summarizeLeadAnalytics(sourceRows, "source"), byStatus: summarizeLeadAnalytics(statusRows, "status"), byCentre: centreRows.map((row) => ({ id: row.id, name: row.name, count: row.count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "analytics_unavailable" }, { status: 503 });
  }
}
