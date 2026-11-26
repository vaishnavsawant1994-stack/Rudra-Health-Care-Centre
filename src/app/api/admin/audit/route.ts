import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { auditCentreScope } from "@/server/audit-read-policy";

const filters = z.object({
  centreId: z.uuid().optional(),
  action: z.string().trim().min(1).max(120).optional(),
  entityType: z.string().trim().min(1).max(80).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to);
const PAGE_SIZE = 100;

export async function GET(request: Request) {
  const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const { centreId, action, entityType, from, to, page } = parsed.data;
  const access = await getApiAccess("audit.read", centreId);
  if (access.response) return access.response;
  const scope = auditCentreScope(access.staff.grants, centreId);
  if (!scope.allowed) return Response.json({ error: "forbidden" }, { status: 403 });
  if (scope.centreIds?.length === 0) return Response.json({ events: [], page, pageSize: PAGE_SIZE, hasMore: false });
  const conditions = [eq(auditEvents.organizationId, access.staff.organizationId)];
  if (scope.centreIds) conditions.push(inArray(auditEvents.centreId, scope.centreIds));
  if (action) conditions.push(eq(auditEvents.action, action));
  if (entityType) conditions.push(eq(auditEvents.entityType, entityType));
  if (from) conditions.push(gte(auditEvents.recordedAt, new Date(`${from}T00:00:00.000Z`)));
  if (to) {
    const exclusiveEnd = new Date(`${to}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    conditions.push(lt(auditEvents.recordedAt, exclusiveEnd));
  }
  const rows = await getDb().select({ sequence: auditEvents.sequence, centreId: auditEvents.centreId, action: auditEvents.action, entityType: auditEvents.entityType, entityId: auditEvents.entityId, details: auditEvents.details, recordedAt: auditEvents.recordedAt }).from(auditEvents).where(and(...conditions)).orderBy(desc(auditEvents.sequence)).limit(PAGE_SIZE + 1).offset((page - 1) * PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;
  return Response.json({ events: rows.slice(0, PAGE_SIZE), page, pageSize: PAGE_SIZE, hasMore }, { headers: { "cache-control": "private, no-store" } });
}
