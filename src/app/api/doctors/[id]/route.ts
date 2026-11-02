import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { openDoctorData, openDoctorEvent, sealDoctorData, sealDoctorEvent } from "@/server/doctor-data";
import { fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";

type Context = { params: Promise<{ id: string }> };
type Profile = { id: string; organization_id: string; centre_id: string; doctor_number: string; specialty: string; status: "ACTIVE" | "INACTIVE"; private_data_ciphertext: string; version_number: number; created_at: Date; updated_at: Date };
function rows<T>(result: unknown) { return (result as { rows?: T[] }).rows ?? []; }
function serialize(row: Profile) { return { id: row.id, centreId: row.centre_id, doctorNumber: row.doctor_number, specialty: row.specialty, status: row.status, ...openDoctorData({ organizationId: row.organization_id, centreId: row.centre_id, id: row.id }, row.private_data_ciphertext), version: row.version_number, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }; }
const patchSchema = z.object({ centreId: z.uuid(), expectedVersion: z.number().int().positive(), name: z.string().trim().min(2).max(160), specialty: z.string().trim().min(2).max(100), phone: z.string().trim().min(7).max(32).nullable(), email: z.email().max(254).nullable(), registrationReference: z.string().trim().max(100).nullable(), affiliation: z.string().trim().max(180).nullable(), notes: z.string().trim().max(1000).nullable(), status: z.enum(["ACTIVE", "INACTIVE"]) }).strict();
export async function GET(request: Request, { params }: Context) {
  const id = z.uuid().safeParse((await params).id); const centreId = z.uuid().safeParse(new URL(request.url).searchParams.get("centreId"));
  if (!id.success || !centreId.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const access = await getApiAccess("doctors.read", centreId.data); if (access.response) return access.response;
  try {
    const result = await getDb().execute(sql`SELECT id, organization_id, centre_id, doctor_number, specialty, status, private_data_ciphertext, version_number, created_at, updated_at FROM doctor_profiles WHERE id = ${id.data} AND organization_id = ${access.staff.organizationId} AND centre_id = ${centreId.data}`);
    const row = rows<Profile>(result)[0]; if (!row) return Response.json({ error: "doctor_not_found" }, { status: 404 });
    const events = rows<{ id: string; event_type: string; private_data_ciphertext: string; actor_staff_id: string; recorded_at: Date }>(await getDb().execute(sql`SELECT id, event_type, private_data_ciphertext, actor_staff_id, recorded_at FROM doctor_relationship_events WHERE doctor_id = ${id.data} AND organization_id = ${access.staff.organizationId} AND centre_id = ${centreId.data} ORDER BY recorded_at DESC, id DESC LIMIT 50`));
    const history = events.map((event) => { const privateEvent = openDoctorEvent({ organizationId: access.staff.organizationId, centreId: centreId.data, id: event.id }, event.private_data_ciphertext); return { type: event.event_type, actorStaffId: event.actor_staff_id, recordedAt: new Date(event.recorded_at).toISOString(), ...(event.event_type === "REFERRAL_RECORDED" ? { category: privateEvent.category, serviceReference: privateEvent.serviceReference ?? null, note: privateEvent.note ?? null, occurredAt: privateEvent.occurredAt ?? null } : {}), ...(event.event_type.startsWith("VISIT_") ? { visitId: privateEvent.visitId, scheduledAt: privateEvent.scheduledAt, purpose: privateEvent.purpose, agenda: privateEvent.agenda, checkedInAt: privateEvent.checkedInAt, summary: privateEvent.summary, followUp: privateEvent.followUp, reason: privateEvent.reason } : {}) }; });
    return Response.json({ doctor: serialize(row), history });
  } catch { return Response.json({ error: "doctor_profile_unavailable" }, { status: 503 }); }
}
export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const id = z.uuid().safeParse((await params).id); if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "invalid_doctor_profile" }, { status: 400 });
  const access = await getApiAccess("doctors.manage", parsed.data.centreId); if (access.response) return access.response;
  const key = request.headers.get("idempotency-key"); if (!key || !z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const requestPayload = { ...parsed.data, actorStaffId: access.staff.staffUserId };
  const requestContext = operationalContext({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, recordId: `${id.data}:${key}` }, "doctor-update-idempotency");
  const requestHash = fingerprintOperationalRequest(requestPayload, requestContext);
  const legacyRequestHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  const db = getDb();
  try {
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:doctor:${key}`}, 0))`);
      const prior = rows<{ doctor_id: string; request_hash: string; actor_staff_id: string }>(await tx.execute(sql`SELECT doctor_id, request_hash, actor_staff_id FROM doctor_relationship_events WHERE organization_id = ${access.staff.organizationId} AND idempotency_key = ${key} LIMIT 1`))[0];
      if (prior) { if (prior.doctor_id !== id.data || prior.actor_staff_id !== access.staff.staffUserId || (!verifyOperationalRequestFingerprint(requestPayload, prior.request_hash, requestContext) && prior.request_hash !== legacyRequestHash)) throw new Error("idempotency_conflict"); const replay = rows<Profile>(await tx.execute(sql`SELECT id, organization_id, centre_id, doctor_number, specialty, status, private_data_ciphertext, version_number, created_at, updated_at FROM doctor_profiles WHERE id = ${id.data} AND organization_id = ${access.staff.organizationId} AND centre_id = ${parsed.data.centreId}`))[0]; if (!replay) throw new Error("doctor_not_found"); return replay; }
      const current = rows<Profile>(await tx.execute(sql`SELECT id, organization_id, centre_id, doctor_number, specialty, status, private_data_ciphertext, version_number, created_at, updated_at FROM doctor_profiles WHERE id = ${id.data} AND organization_id = ${access.staff.organizationId} AND centre_id = ${parsed.data.centreId} FOR UPDATE`))[0];
      if (!current) throw new Error("doctor_not_found"); if (current.version_number !== parsed.data.expectedVersion) throw new Error("version_conflict");
      const nextPrivate = { name: parsed.data.name, phone: parsed.data.phone, email: parsed.data.email?.toLowerCase() ?? null, registrationReference: parsed.data.registrationReference, affiliation: parsed.data.affiliation, notes: parsed.data.notes };
      const nextCipher = sealDoctorData({ organizationId: current.organization_id, centreId: current.centre_id, id: current.id }, nextPrivate);
      const updated = rows<Profile>(await tx.execute(sql`UPDATE doctor_profiles SET specialty = ${parsed.data.specialty}, status = ${parsed.data.status}, private_data_ciphertext = ${nextCipher}, version_number = version_number + 1, updated_by_staff_id = ${access.staff.staffUserId}, updated_at = now() WHERE id = ${current.id} AND version_number = ${parsed.data.expectedVersion} RETURNING id, organization_id, centre_id, doctor_number, specialty, status, private_data_ciphertext, version_number, created_at, updated_at`))[0];
      if (!updated) throw new Error("version_conflict");
      const eventId = randomUUID(); const eventType = current.status === updated.status ? "UPDATED" : "STATUS_CHANGED";
      const eventCipher = sealDoctorEvent({ organizationId: current.organization_id, centreId: current.centre_id, id: eventId }, { previousVersion: current.version_number, version: updated.version_number });
      await tx.execute(sql`INSERT INTO doctor_relationship_events (id, organization_id, centre_id, doctor_id, event_type, private_data_ciphertext, actor_staff_id, idempotency_key, request_hash) VALUES (${eventId}, ${current.organization_id}, ${current.centre_id}, ${current.id}, ${eventType}, ${eventCipher}, ${access.staff.staffUserId}, ${key}, ${requestHash})`);
      await appendAuditEvent(tx, { organizationId: current.organization_id, centreId: current.centre_id, actorStaffId: access.staff.staffUserId, action: "doctor_profile.updated", entityType: "doctor_profile", entityId: current.id, details: { version: updated.version_number, statusChanged: current.status !== updated.status } }); return updated;
    });
    return Response.json({ doctor: serialize(row) });
  } catch (error) { const code = error instanceof Error ? error.message : ""; if (code === "doctor_not_found") return Response.json({ error: code }, { status: 404 }); if (code === "version_conflict" || code === "idempotency_conflict") return Response.json({ error: code }, { status: 409 }); return Response.json({ error: "doctor_profile_update_unavailable" }, { status: 409 }); }
}
