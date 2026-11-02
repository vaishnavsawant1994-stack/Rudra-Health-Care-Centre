import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { openBusinessRelationship, openBusinessRelationshipEvent, sealBusinessRelationship, sealBusinessRelationshipEvent, type BusinessRelationshipPrivateData, type BusinessRelationshipType } from "@/server/business-relationship-data";
import { legacyRelationshipUpdateFingerprint, relationshipUpdateFingerprint, sameRelationshipPrivateData } from "@/server/business-relationship-idempotency";

type Context = { params: Promise<{ id: string }> };
type Row = { id: string; organization_id: string; centre_id: string; relationship_type: BusinessRelationshipType; relationship_number: string; category: string; status: "ACTIVE" | "INACTIVE"; private_data_ciphertext: string; version_number: number; created_at: Date; updated_at: Date };
function rows<T>(result: unknown) { return (result as { rows?: T[] }).rows ?? []; }
function permission(type: BusinessRelationshipType, action: "read" | "manage") { return `${type === "CORPORATE" ? "corporate" : "partners"}.${action}` as "corporate.read" | "corporate.manage" | "partners.read" | "partners.manage"; }
function serialize(row: Row) { return { id: row.id, centreId: row.centre_id, type: row.relationship_type, relationshipNumber: row.relationship_number, category: row.category, status: row.status, ...openBusinessRelationship({ organizationId: row.organization_id, centreId: row.centre_id, id: row.id }, row.relationship_type, row.private_data_ciphertext), version: row.version_number, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }; }
const querySchema = z.object({ centreId: z.uuid(), type: z.enum(["CORPORATE", "PARTNER"]) });
const updateSchema = z.object({ centreId: z.uuid(), type: z.enum(["CORPORATE", "PARTNER"]), expectedVersion: z.number().int().positive(), category: z.string().trim().min(2).max(40), status: z.enum(["ACTIVE", "INACTIVE"]), privateData: z.object({ name: z.string().trim().min(2).max(160), legalName: z.string().trim().max(180).nullable(), primaryContactName: z.string().trim().max(120).nullable(), primaryContactRole: z.string().trim().max(100).nullable(), phone: z.string().trim().min(7).max(32).nullable(), email: z.email().max(254).nullable(), address: z.string().trim().max(500).nullable(), agreementReference: z.string().trim().max(120).nullable(), agreementStatus: z.enum(["NOT_RECORDED", "PENDING_REVIEW"]), notes: z.string().trim().max(1500).nullable() }) }).strict();
function normalizedPrivate(data: BusinessRelationshipPrivateData): BusinessRelationshipPrivateData { return { ...data, email: data.email?.toLowerCase() || null }; }

export async function GET(request: Request, { params }: Context) {
  const id = z.uuid().safeParse((await params).id); const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!id.success || !query.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const access = await getApiAccess(permission(query.data.type, "read"), query.data.centreId); if (access.response) return access.response;
  try {
    const result = await getDb().execute(sql`SELECT id,organization_id,centre_id,relationship_type,relationship_number,category,status,private_data_ciphertext,version_number,created_at,updated_at FROM business_relationships WHERE id=${id.data} AND organization_id=${access.staff.organizationId} AND centre_id=${query.data.centreId} AND relationship_type=${query.data.type}`);
    const row = rows<Row>(result)[0]; if (!row) return Response.json({ error: "relationship_not_found" }, { status: 404 });
    const events = rows<{ id: string; event_type: string; private_data_ciphertext: string; actor_staff_id: string; recorded_at: Date }>(await getDb().execute(sql`SELECT id,event_type,private_data_ciphertext,actor_staff_id,recorded_at FROM business_relationship_events WHERE relationship_id=${id.data} AND organization_id=${access.staff.organizationId} AND centre_id=${query.data.centreId} AND relationship_type=${query.data.type} ORDER BY recorded_at DESC,id DESC LIMIT 100`));
    const history = events.map((event) => ({ type: event.event_type, actorStaffId: event.actor_staff_id, recordedAt: new Date(event.recorded_at).toISOString(), ...openBusinessRelationshipEvent({ organizationId: access.staff.organizationId, centreId: query.data.centreId, id: event.id }, query.data.type, event.private_data_ciphertext) }));
    return Response.json({ relationship: serialize(row), history });
  } catch { return Response.json({ error: "relationship_unavailable" }, { status: 503 }); }
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const id = z.uuid().safeParse((await params).id); if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "invalid_relationship" }, { status: 400 });
  const access = await getApiAccess(permission(parsed.data.type, "manage"), parsed.data.centreId); if (access.response) return access.response;
  const key = request.headers.get("idempotency-key"); if (!key || !z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const privateData = normalizedPrivate(parsed.data.privateData);
  const publicRequest = { id: id.data, centreId: parsed.data.centreId, type: parsed.data.type, expectedVersion: parsed.data.expectedVersion, category: parsed.data.category, status: parsed.data.status };
  const requestHash = relationshipUpdateFingerprint(publicRequest);
  const legacyRequestHash = legacyRelationshipUpdateFingerprint({ id: id.data, ...parsed.data, privateData });
  try {
    let replayed = false;
    const updated = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:business-relationship:${key}`},0))`);
      const prior = rows<{ id: string; relationship_id: string; request_hash: string; centre_id: string; relationship_type: BusinessRelationshipType; private_data_ciphertext: string }>(await tx.execute(sql`SELECT id,relationship_id,request_hash,centre_id,relationship_type,private_data_ciphertext FROM business_relationship_events WHERE organization_id=${access.staff.organizationId} AND idempotency_key=${key} LIMIT 1`))[0];
      if (prior) {
        if (prior.relationship_id !== id.data || (prior.request_hash !== requestHash && prior.request_hash !== legacyRequestHash)) throw new Error("idempotency_conflict");
        if (prior.request_hash === requestHash) {
          const eventData = openBusinessRelationshipEvent({ organizationId: access.staff.organizationId, centreId: prior.centre_id, id: prior.id }, prior.relationship_type, prior.private_data_ciphertext);
          if (!sameRelationshipPrivateData(eventData.privateData, privateData)) throw new Error("idempotency_conflict");
        }
        const row = rows<Row>(await tx.execute(sql`SELECT id,organization_id,centre_id,relationship_type,relationship_number,category,status,private_data_ciphertext,version_number,created_at,updated_at FROM business_relationships WHERE id=${id.data} AND organization_id=${access.staff.organizationId} AND centre_id=${parsed.data.centreId} AND relationship_type=${parsed.data.type}`))[0];
        if (!row) throw new Error("not_found"); replayed = true; return row;
      }
      const current = rows<Row>(await tx.execute(sql`SELECT id,organization_id,centre_id,relationship_type,relationship_number,category,status,private_data_ciphertext,version_number,created_at,updated_at FROM business_relationships WHERE id=${id.data} AND organization_id=${access.staff.organizationId} AND centre_id=${parsed.data.centreId} AND relationship_type=${parsed.data.type} FOR UPDATE`))[0];
      if (!current) throw new Error("not_found"); if (current.version_number !== parsed.data.expectedVersion) throw new Error("version_conflict");
      const cipher = sealBusinessRelationship({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id: id.data }, parsed.data.type, privateData);
      const result = rows<Row>(await tx.execute(sql`UPDATE business_relationships SET category=${parsed.data.category},status=${parsed.data.status},private_data_ciphertext=${cipher},version_number=version_number+1,updated_by_staff_id=${access.staff.staffUserId},updated_at=now() WHERE id=${id.data} AND organization_id=${access.staff.organizationId} AND centre_id=${parsed.data.centreId} AND relationship_type=${parsed.data.type} AND version_number=${parsed.data.expectedVersion} RETURNING id,organization_id,centre_id,relationship_type,relationship_number,category,status,private_data_ciphertext,version_number,created_at,updated_at`))[0];
      const eventId = randomUUID(); const eventCipher = sealBusinessRelationshipEvent({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id: eventId }, parsed.data.type, { previousVersion: current.version_number, version: result.version_number, privateData });
      await tx.execute(sql`INSERT INTO business_relationship_events(id,organization_id,centre_id,relationship_id,relationship_type,event_type,private_data_ciphertext,actor_staff_id,idempotency_key,request_hash) VALUES(${eventId},${access.staff.organizationId},${parsed.data.centreId},${id.data},${parsed.data.type},${current.status === parsed.data.status ? "UPDATED" : "STATUS_CHANGED"},${eventCipher},${access.staff.staffUserId},${key},${requestHash})`);
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "business_relationship.updated", entityType: "business_relationship", entityId: id.data, details: { type: parsed.data.type, category: parsed.data.category, status: parsed.data.status, version: result.version_number } });
      return result;
    });
    return Response.json({ relationship: serialize(updated), replayed });
  } catch (error) { const code = error instanceof Error ? error.message : ""; return Response.json({ error: ["idempotency_conflict", "version_conflict"].includes(code) ? code : "relationship_update_failed" }, { status: code === "version_conflict" || code === "idempotency_conflict" ? 409 : code === "not_found" ? 404 : 500 }); }
}
