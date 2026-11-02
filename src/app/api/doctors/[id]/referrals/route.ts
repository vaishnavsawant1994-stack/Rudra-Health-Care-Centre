import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { sealDoctorEvent } from "@/server/doctor-data";
import { fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";

const schema = z.object({ centreId: z.uuid(), category: z.enum(["TEST_ENQUIRY", "PACKAGE_ENQUIRY", "APPOINTMENT_REQUEST", "HOME_COLLECTION_REQUEST", "OTHER"]), serviceReference: z.string().trim().max(120).nullable().optional(), note: z.string().trim().max(800).nullable().optional(), occurredAt: z.iso.datetime().optional() }).strict();
function rows<T>(result: unknown) { return (result as { rows?: T[] }).rows ?? []; }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const id = z.uuid().safeParse((await context.params).id); if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "invalid_referral_activity" }, { status: 400 });
  const access = await getApiAccess("doctors.manage", parsed.data.centreId); if (access.response) return access.response;
  const key = request.headers.get("idempotency-key"); if (!key || !z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const requestPayload = { ...parsed.data, actorStaffId: access.staff.staffUserId };
  const requestContext = operationalContext({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, recordId: `${id.data}:${key}` }, "doctor-referral-idempotency");
  const fingerprint = fingerprintOperationalRequest(requestPayload, requestContext);
  const legacyFingerprint = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex"); const db = getDb();
  try {
    const event = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:doctor:${key}`}, 0))`);
      const prior = rows<{ doctor_id: string; request_hash: string; event_id: string; actor_staff_id: string }>(await tx.execute(sql`SELECT doctor_id, request_hash, id AS event_id, actor_staff_id FROM doctor_relationship_events WHERE organization_id = ${access.staff.organizationId} AND idempotency_key = ${key} LIMIT 1`))[0];
      if (prior) { if (prior.doctor_id !== id.data || prior.actor_staff_id !== access.staff.staffUserId || (!verifyOperationalRequestFingerprint(requestPayload, prior.request_hash, requestContext) && prior.request_hash !== legacyFingerprint)) throw new Error("idempotency_conflict"); return { id: prior.event_id, replayed: true }; }
      const profile = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM doctor_profiles WHERE id = ${id.data} AND organization_id = ${access.staff.organizationId} AND centre_id = ${parsed.data.centreId} FOR UPDATE`))[0];
      if (!profile) throw new Error("doctor_not_found");
      const eventId = randomUUID(); const envelope = sealDoctorEvent({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id: eventId }, { category: parsed.data.category, serviceReference: parsed.data.serviceReference ?? null, note: parsed.data.note ?? null, occurredAt: parsed.data.occurredAt ?? new Date().toISOString() });
      await tx.execute(sql`INSERT INTO doctor_relationship_events(id,organization_id,centre_id,doctor_id,event_type,private_data_ciphertext,actor_staff_id,idempotency_key,request_hash) VALUES(${eventId},${access.staff.organizationId},${parsed.data.centreId},${id.data},'REFERRAL_RECORDED',${envelope},${access.staff.staffUserId},${key},${fingerprint})`);
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "doctor.referral_activity.recorded", entityType: "doctor_profile", entityId: id.data, details: { category: parsed.data.category } });
      return { id: eventId, replayed: false };
    });
    return Response.json({ event }, { status: event.replayed ? 200 : 201 });
  } catch (error) { const code = error instanceof Error ? error.message : ""; if (code === "doctor_not_found") return Response.json({ error: code }, { status: 404 }); if (code === "idempotency_conflict") return Response.json({ error: code }, { status: 409 }); return Response.json({ error: "referral_activity_unavailable" }, { status: 409 }); }
}
