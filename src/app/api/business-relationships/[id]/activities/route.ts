import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { openBusinessRelationshipEvent, sealBusinessRelationshipEvent, type BusinessRelationshipType } from "@/server/business-relationship-data";
import { legacyRelationshipActivityFingerprint, relationshipActivityFingerprint, sameRelationshipActivityPrivateData } from "@/server/business-relationship-idempotency";

type Context = { params: Promise<{ id: string }> };
function permission(type: BusinessRelationshipType) { return type === "CORPORATE" ? "corporate.manage" : "partners.manage"; }
const schema = z.object({ centreId: z.uuid(), type: z.enum(["CORPORATE", "PARTNER"]), category: z.enum(["ENQUIRY", "MEETING", "FOLLOW_UP", "REFERRAL", "AGREEMENT_REVIEW", "OTHER"]), serviceReference: z.string().trim().max(120).nullable().default(null), note: z.string().trim().max(1000).nullable().default(null), occurredAt: z.iso.datetime().nullable().default(null) }).strict();

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const id = z.uuid().safeParse((await params).id); if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "invalid_activity" }, { status: 400 });
  const access = await getApiAccess(permission(parsed.data.type), parsed.data.centreId); if (access.response) return access.response;
  const key = request.headers.get("idempotency-key"); if (!key || !z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const body = { category: parsed.data.category, serviceReference: parsed.data.serviceReference || null, note: parsed.data.note || null, occurredAt: parsed.data.occurredAt || null };
  const publicRequest = { id: id.data, centreId: parsed.data.centreId, type: parsed.data.type, category: body.category, occurredAt: body.occurredAt };
  const requestHash = relationshipActivityFingerprint(publicRequest);
  const legacyRequestHash = legacyRelationshipActivityFingerprint({ id: id.data, centreId: parsed.data.centreId, type: parsed.data.type, body });
  try {
    const outcome = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:business-relationship:${key}`},0))`);
      const prior = await tx.execute(sql`SELECT id,relationship_id,centre_id,relationship_type,event_type,private_data_ciphertext,request_hash FROM business_relationship_events WHERE organization_id=${access.staff.organizationId} AND idempotency_key=${key} LIMIT 1`);
      const priorRow = (prior as unknown as { rows?: Array<{ id: string; relationship_id: string; centre_id: string; relationship_type: BusinessRelationshipType; event_type: string; private_data_ciphertext: string; request_hash: string }> }).rows?.[0];
      if (priorRow) {
        if (priorRow.relationship_id !== id.data || priorRow.event_type !== "ACTIVITY_RECORDED" || (priorRow.request_hash !== requestHash && priorRow.request_hash !== legacyRequestHash)) throw new Error("idempotency_conflict");
        if (priorRow.request_hash === requestHash) {
          const priorBody = openBusinessRelationshipEvent({ organizationId: access.staff.organizationId, centreId: priorRow.centre_id, id: priorRow.id }, priorRow.relationship_type, priorRow.private_data_ciphertext);
          if (!sameRelationshipActivityPrivateData(priorBody, { serviceReference: body.serviceReference, note: body.note })) throw new Error("idempotency_conflict");
        }
        return { replayed: true };
      }
      const found = await tx.execute(sql`SELECT id FROM business_relationships WHERE id=${id.data} AND organization_id=${access.staff.organizationId} AND centre_id=${parsed.data.centreId} AND relationship_type=${parsed.data.type}`);
      if (!(found as { rows?: unknown[] }).rows?.length) throw new Error("not_found");
      const eventId = randomUUID(); const cipher = sealBusinessRelationshipEvent({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id: eventId }, parsed.data.type, body);
      await tx.execute(sql`INSERT INTO business_relationship_events(id,organization_id,centre_id,relationship_id,relationship_type,event_type,private_data_ciphertext,actor_staff_id,idempotency_key,request_hash) VALUES(${eventId},${access.staff.organizationId},${parsed.data.centreId},${id.data},${parsed.data.type},'ACTIVITY_RECORDED',${cipher},${access.staff.staffUserId},${key},${requestHash})`);
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "business_relationship.activity_recorded", entityType: "business_relationship", entityId: id.data, details: { type: parsed.data.type, category: parsed.data.category } });
      return { replayed: false };
    });
    return Response.json({ recorded: true, ...outcome }, { status: outcome.replayed ? 200 : 201 });
  } catch (error) { const code = error instanceof Error ? error.message : ""; return Response.json({ error: code === "idempotency_conflict" ? code : "activity_record_failed" }, { status: code === "idempotency_conflict" ? 409 : code === "not_found" ? 404 : 500 }); }
}
