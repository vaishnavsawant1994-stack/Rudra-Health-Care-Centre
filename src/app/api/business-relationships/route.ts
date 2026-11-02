import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { openBusinessRelationship, openBusinessRelationshipEvent, sealBusinessRelationship, sealBusinessRelationshipEvent, type BusinessRelationshipPrivateData, type BusinessRelationshipType } from "@/server/business-relationship-data";
import { legacyRelationshipCreateFingerprint, relationshipCreateFingerprint, sameRelationshipPrivateData } from "@/server/business-relationship-idempotency";
import { hasPermission } from "@/server/permissions";
import { parseRelationshipAttributionRange } from "@/server/relationship-attribution-range";

const typeSchema = z.enum(["CORPORATE", "PARTNER"]);
const filters = z.object({ centreId: z.uuid(), type: typeSchema, status: z.enum(["ACTIVE", "INACTIVE"]).optional(), category: z.string().trim().max(40).optional(), attributionFrom: z.string().optional(), attributionTo: z.string().optional(), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(25) });
const privateSchema = z.object({ name: z.string().trim().min(2).max(160), legalName: z.string().trim().max(180).nullable().optional(), primaryContactName: z.string().trim().max(120).nullable().optional(), primaryContactRole: z.string().trim().max(100).nullable().optional(), phone: z.string().trim().min(7).max(32).nullable().optional(), email: z.email().max(254).nullable().optional(), address: z.string().trim().max(500).nullable().optional(), agreementReference: z.string().trim().max(120).nullable().optional(), agreementStatus: z.enum(["NOT_RECORDED", "PENDING_REVIEW"]).default("NOT_RECORDED"), notes: z.string().trim().max(1500).nullable().optional() });
const createSchema = z.object({ centreId: z.uuid(), type: typeSchema, category: z.string().trim().min(2).max(40), privateData: privateSchema }).strict();
type Row = { id: string; organization_id: string; centre_id: string; relationship_type: BusinessRelationshipType; relationship_number: string; category: string; status: "ACTIVE" | "INACTIVE"; private_data_ciphertext: string; version_number: number; created_at: Date; updated_at: Date };
function rows<T>(result: unknown) { return (result as { rows?: T[] }).rows ?? []; }
function serialize(row: Row) { return { id: row.id, centreId: row.centre_id, type: row.relationship_type, relationshipNumber: row.relationship_number, category: row.category, status: row.status, ...openBusinessRelationship({ organizationId: row.organization_id, centreId: row.centre_id, id: row.id }, row.relationship_type, row.private_data_ciphertext), version: row.version_number, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }; }
function permission(type: BusinessRelationshipType, action: "read" | "manage") { return `${type === "CORPORATE" ? "corporate" : "partners"}.${action}` as "corporate.read" | "corporate.manage" | "partners.read" | "partners.manage"; }

export async function GET(request: Request) {
  const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const attributionRange = parseRelationshipAttributionRange(parsed.data.attributionFrom, parsed.data.attributionTo);
  if (!attributionRange) return Response.json({ error: "invalid_attribution_date_range" }, { status: 400 });
  const access = await getApiAccess(permission(parsed.data.type, "read"), parsed.data.centreId);
  if (access.response) return access.response;
  try {
    const result = await getDb().execute(sql`SELECT id, organization_id, centre_id, relationship_type, relationship_number, category, status, private_data_ciphertext, version_number, created_at, updated_at FROM business_relationships WHERE organization_id=${access.staff.organizationId} AND centre_id=${parsed.data.centreId} AND relationship_type=${parsed.data.type} AND (${parsed.data.status ?? null}::text IS NULL OR status=${parsed.data.status ?? null}) AND (${parsed.data.category ?? null}::text IS NULL OR category=${parsed.data.category ?? null}) ORDER BY category, relationship_number LIMIT ${parsed.data.pageSize + 1} OFFSET ${(parsed.data.page - 1) * parsed.data.pageSize}`);
    const found = rows<Row>(result);
    const pageRows = found.slice(0, parsed.data.pageSize);
    const canReadLeads = hasPermission(access.staff.grants, "leads.read", parsed.data.centreId);
    let attributed = new Map<string, { leads: number; converted: number }>();
    if (canReadLeads && pageRows.length) {
      const ids = pageRows.map((row) => row.id);
      const metrics = rows<{ source_relationship_id: string; lead_count: number; converted_count: number }>(await getDb().execute(sql`
        SELECT l.source_relationship_id,
          count(*)::int AS lead_count,
          count(lc.lead_id)::int AS converted_count
        FROM leads l
        LEFT JOIN lead_conversions lc
          ON lc.lead_id=l.id AND lc.organization_id=l.organization_id AND lc.centre_id=l.centre_id
        WHERE l.organization_id=${access.staff.organizationId} AND l.centre_id=${parsed.data.centreId}
          AND l.source_relationship_type=${parsed.data.type}
          AND l.source_relationship_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
          AND (${attributionRange.from}::timestamptz IS NULL OR l.created_at >= ${attributionRange.from})
          AND (${attributionRange.toExclusive}::timestamptz IS NULL OR l.created_at < ${attributionRange.toExclusive})
        GROUP BY l.source_relationship_id`));
      attributed = new Map(metrics.map((row) => [row.source_relationship_id, { leads: row.lead_count, converted: row.converted_count }]));
    }
    return Response.json({ relationships: pageRows.map((row) => ({ ...serialize(row), ...(canReadLeads ? { attribution: attributed.get(row.id) ?? { leads: 0, converted: 0 } } : {}) })), page: parsed.data.page, pageSize: parsed.data.pageSize, hasMore: found.length > parsed.data.pageSize });
  } catch { return Response.json({ error: "business_relationships_unavailable" }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_relationship" }, { status: 400 });
  const access = await getApiAccess(permission(parsed.data.type, "manage"), parsed.data.centreId);
  if (access.response) return access.response;
  const key = request.headers.get("idempotency-key");
  if (!key || !z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const privateData: BusinessRelationshipPrivateData = { name: parsed.data.privateData.name, legalName: parsed.data.privateData.legalName || null, primaryContactName: parsed.data.privateData.primaryContactName || null, primaryContactRole: parsed.data.privateData.primaryContactRole || null, phone: parsed.data.privateData.phone || null, email: parsed.data.privateData.email?.toLowerCase() || null, address: parsed.data.privateData.address || null, agreementReference: parsed.data.privateData.agreementReference || null, agreementStatus: parsed.data.privateData.agreementStatus, notes: parsed.data.privateData.notes || null };
  const publicRequest = { centreId: parsed.data.centreId, type: parsed.data.type, category: parsed.data.category };
  const requestHash = relationshipCreateFingerprint(publicRequest);
  const legacyRequestHash = legacyRelationshipCreateFingerprint({ ...parsed.data, privateData });
  const db = getDb();
  try {
    let replayed = false;
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:business-relationship:${key}`},0))`);
      const prior = rows<{ id: string; relationship_id: string; request_hash: string; centre_id: string; relationship_type: BusinessRelationshipType; private_data_ciphertext: string }>(await tx.execute(sql`SELECT id,relationship_id,request_hash,centre_id,relationship_type,private_data_ciphertext FROM business_relationship_events WHERE organization_id=${access.staff.organizationId} AND idempotency_key=${key} LIMIT 1`))[0];
      if (prior) {
        if (prior.request_hash !== requestHash && prior.request_hash !== legacyRequestHash) throw new Error("idempotency_conflict");
        if (prior.request_hash === requestHash) {
          const eventData = openBusinessRelationshipEvent({ organizationId: access.staff.organizationId, centreId: prior.centre_id, id: prior.id }, prior.relationship_type, prior.private_data_ciphertext);
          if (!sameRelationshipPrivateData(eventData.privateData, privateData)) throw new Error("idempotency_conflict");
        }
        const match = rows<Row>(await tx.execute(sql`SELECT id, organization_id, centre_id, relationship_type, relationship_number, category, status, private_data_ciphertext, version_number, created_at, updated_at FROM business_relationships WHERE id=${prior.relationship_id} AND organization_id=${access.staff.organizationId} AND centre_id=${parsed.data.centreId} AND relationship_type=${parsed.data.type}`))[0];
        if (!match) throw new Error("idempotency_scope_conflict"); replayed = true; return match;
      }
      const id = randomUUID(); const number = `RHC-${parsed.data.type === "CORPORATE" ? "C" : "P"}-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`;
      const cipher = sealBusinessRelationship({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id }, parsed.data.type, privateData);
      const row = rows<Row>(await tx.execute(sql`INSERT INTO business_relationships(id,organization_id,centre_id,relationship_type,relationship_number,category,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES(${id},${access.staff.organizationId},${parsed.data.centreId},${parsed.data.type},${number},${parsed.data.category},${cipher},${access.staff.staffUserId},${access.staff.staffUserId}) RETURNING id,organization_id,centre_id,relationship_type,relationship_number,category,status,private_data_ciphertext,version_number,created_at,updated_at`))[0];
      const eventId = randomUUID(); const eventCipher = sealBusinessRelationshipEvent({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id: eventId }, parsed.data.type, { version: 1, privateData });
      await tx.execute(sql`INSERT INTO business_relationship_events(id,organization_id,centre_id,relationship_id,relationship_type,event_type,private_data_ciphertext,actor_staff_id,idempotency_key,request_hash) VALUES(${eventId},${access.staff.organizationId},${parsed.data.centreId},${id},${parsed.data.type},'CREATED',${eventCipher},${access.staff.staffUserId},${key},${requestHash})`);
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "business_relationship.created", entityType: "business_relationship", entityId: id, details: { type: parsed.data.type, category: parsed.data.category } });
      return row;
    });
    return Response.json({ relationship: serialize(created), replayed }, { status: replayed ? 200 : 201 });
  } catch (error) { const code = error instanceof Error ? error.message : ""; return Response.json({ error: code === "idempotency_conflict" || code === "idempotency_scope_conflict" ? code : "business_relationship_create_failed" }, { status: code.startsWith("idempotency_") ? 409 : 500 }); }
}
