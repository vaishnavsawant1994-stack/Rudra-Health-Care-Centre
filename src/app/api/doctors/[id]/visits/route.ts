import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { openDoctorEvent, sealDoctorEvent } from "@/server/doctor-data";
import { fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";

type Context = { params: Promise<{ id: string }> };
type VisitEvent = { id: string; event_type: string; private_data_ciphertext: string; actor_staff_id: string; recorded_at: Date };
function rows<T>(result: unknown) { return (result as { rows?: T[] }).rows ?? []; }

const listSchema = z.object({ centreId: z.uuid(), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) });

export async function GET(request: Request, { params }: Context) {
  const id = z.uuid().safeParse((await params).id);
  const parsed = listSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!id.success || !parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const access = await getApiAccess("doctors.read", parsed.data.centreId);
  if (access.response) return access.response;
  try {
    const result = await getDb().execute(sql`SELECT e.id,e.event_type,e.private_data_ciphertext,e.actor_staff_id,e.recorded_at FROM doctor_relationship_events e JOIN doctor_profiles d ON d.id=e.doctor_id AND d.organization_id=e.organization_id AND d.centre_id=e.centre_id WHERE e.doctor_id=${id.data} AND e.organization_id=${access.staff.organizationId} AND e.centre_id=${parsed.data.centreId} AND e.event_type IN ('VISIT_PLANNED','VISIT_CHECKED_IN','VISIT_RECORDED','VISIT_CANCELLED') ORDER BY e.recorded_at DESC,e.id DESC`);
    const events = rows<VisitEvent>(result);
    const byVisit = new Map<string, Record<string, unknown>>();
    for (const event of events) {
      const privateData = openDoctorEvent({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id: event.id }, event.private_data_ciphertext);
      if (typeof privateData.visitId !== "string") continue;
      const visit = byVisit.get(privateData.visitId) ?? { id: privateData.visitId, scheduledAt: null, purpose: "OTHER", agenda: null, checkedInAt: null, summary: null, followUp: null, cancelled: null, events: [] as Array<{ type: string; actorStaffId: string; recordedAt: string }> };
      if (event.event_type === "VISIT_PLANNED") { visit.scheduledAt = privateData.scheduledAt; visit.purpose = privateData.purpose; visit.agenda = privateData.agenda ?? null; }
      if (event.event_type === "VISIT_CHECKED_IN") visit.checkedInAt = privateData.checkedInAt;
      if (event.event_type === "VISIT_RECORDED") { visit.summary = privateData.summary; visit.followUp = privateData.followUp ?? null; }
      if (event.event_type === "VISIT_CANCELLED") visit.cancelled = privateData.reason;
      (visit.events as Array<{ type: string; actorStaffId: string; recordedAt: string }>).push({ type: event.event_type, actorStaffId: event.actor_staff_id, recordedAt: new Date(event.recorded_at).toISOString() });
      byVisit.set(privateData.visitId, visit);
    }
    const allVisits = [...byVisit.values()].sort((a, b) => String(b.scheduledAt ?? "").localeCompare(String(a.scheduledAt ?? "")));
    const offset = (parsed.data.page - 1) * parsed.data.pageSize;
    return Response.json({ visits: allVisits.slice(offset, offset + parsed.data.pageSize), page: parsed.data.page, pageSize: parsed.data.pageSize, hasMore: offset + parsed.data.pageSize < allVisits.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "doctor_visit_history_unavailable" }, { status: 503 }); }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PLAN"), centreId: z.uuid(), scheduledAt: z.iso.datetime(), purpose: z.enum(["RELATIONSHIP", "SERVICE_OVERVIEW", "FOLLOW_UP", "OTHER"]), agenda: z.string().trim().max(500).nullable().optional() }).strict(),
  z.object({ action: z.literal("CHECK_IN"), centreId: z.uuid(), visitId: z.uuid() }).strict(),
  z.object({ action: z.literal("RECORD"), centreId: z.uuid(), visitId: z.uuid(), summary: z.string().trim().min(2).max(1200), followUp: z.string().trim().max(600).nullable().optional() }).strict(),
  z.object({ action: z.literal("CANCEL"), centreId: z.uuid(), visitId: z.uuid(), reason: z.string().trim().min(2).max(400) }).strict(),
]);

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_visit_action" }, { status: 400 });
  const access = await getApiAccess("doctors.manage", parsed.data.centreId);
  if (access.response) return access.response;
  const key = request.headers.get("idempotency-key");
  if (!key || !z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  if (parsed.data.action === "PLAN" && Date.parse(parsed.data.scheduledAt) <= Date.now()) return Response.json({ error: "visit_must_be_scheduled_in_future" }, { status: 400 });

  const payload = { ...parsed.data, actorStaffId: access.staff.staffUserId };
  const context = operationalContext({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, recordId: `${id.data}:${key}` }, "doctor-visit-idempotency");
  const requestHash = fingerprintOperationalRequest(payload, context);
  const legacyHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  try {
    const outcome = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:doctor:${key}`}, 0))`);
      const prior = rows<{ doctor_id: string; id: string; event_type: string; request_hash: string; actor_staff_id: string }>(await tx.execute(sql`SELECT doctor_id,id,event_type,request_hash,actor_staff_id FROM doctor_relationship_events WHERE organization_id=${access.staff.organizationId} AND idempotency_key=${key} LIMIT 1`))[0];
      if (prior) {
        if (prior.doctor_id !== id.data || prior.actor_staff_id !== access.staff.staffUserId || (!verifyOperationalRequestFingerprint(payload, prior.request_hash, context) && prior.request_hash !== legacyHash)) throw new Error("idempotency_conflict");
        const priorData = openDoctorEvent({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id: prior.id }, rows<{ private_data_ciphertext: string }>(await tx.execute(sql`SELECT private_data_ciphertext FROM doctor_relationship_events WHERE id=${prior.id} AND organization_id=${access.staff.organizationId} AND centre_id=${parsed.data.centreId}`))[0]?.private_data_ciphertext ?? "");
        return { eventId: prior.id, eventType: prior.event_type, visitId: typeof priorData.visitId === "string" ? priorData.visitId : null, replayed: true };
      }
      const profile = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM doctor_profiles WHERE id=${id.data} AND organization_id=${access.staff.organizationId} AND centre_id=${parsed.data.centreId} AND status='ACTIVE' FOR UPDATE`))[0];
      if (!profile) throw new Error("doctor_not_found");
      const events = rows<VisitEvent>(await tx.execute(sql`SELECT id,event_type,private_data_ciphertext,actor_staff_id,recorded_at FROM doctor_relationship_events WHERE doctor_id=${id.data} AND organization_id=${access.staff.organizationId} AND centre_id=${parsed.data.centreId} AND event_type IN ('VISIT_PLANNED','VISIT_CHECKED_IN','VISIT_RECORDED','VISIT_CANCELLED') ORDER BY recorded_at,id`));
      const visits = new Map<string, { planned: boolean; checkedIn: boolean; terminal: boolean }>();
      for (const event of events) {
        const privateData = openDoctorEvent({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id: event.id }, event.private_data_ciphertext);
        if (typeof privateData.visitId !== "string") continue;
        const visit = visits.get(privateData.visitId) ?? { planned: false, checkedIn: false, terminal: false };
        if (event.event_type === "VISIT_PLANNED") visit.planned = true;
        if (event.event_type === "VISIT_CHECKED_IN") visit.checkedIn = true;
        if (event.event_type === "VISIT_RECORDED" || event.event_type === "VISIT_CANCELLED") visit.terminal = true;
        visits.set(privateData.visitId, visit);
      }
      let eventType: string;
      let privateData: Record<string, unknown>;
      if (parsed.data.action === "PLAN") {
        eventType = "VISIT_PLANNED";
        privateData = { visitId: randomUUID(), scheduledAt: new Date(parsed.data.scheduledAt).toISOString(), purpose: parsed.data.purpose, agenda: parsed.data.agenda ?? null };
      } else {
        const visit = visits.get(parsed.data.visitId);
        if (!visit?.planned) throw new Error("visit_plan_not_found");
        if (visit.terminal) throw new Error("visit_already_closed");
        if (parsed.data.action === "CHECK_IN") {
          if (visit.checkedIn) throw new Error("visit_already_checked_in");
          eventType = "VISIT_CHECKED_IN";
          privateData = { visitId: parsed.data.visitId, checkedInAt: new Date().toISOString() };
        } else if (parsed.data.action === "RECORD") {
          if (!visit.checkedIn) throw new Error("visit_check_in_required");
          eventType = "VISIT_RECORDED";
          privateData = { visitId: parsed.data.visitId, recordedAt: new Date().toISOString(), summary: parsed.data.summary, followUp: parsed.data.followUp ?? null };
        } else {
          if (visit.checkedIn) throw new Error("checked_in_visit_cannot_be_cancelled");
          eventType = "VISIT_CANCELLED";
          privateData = { visitId: parsed.data.visitId, reason: parsed.data.reason };
        }
      }
      const eventId = randomUUID();
      const ciphertext = sealDoctorEvent({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, id: eventId }, privateData);
      await tx.execute(sql`INSERT INTO doctor_relationship_events(id,organization_id,centre_id,doctor_id,event_type,private_data_ciphertext,actor_staff_id,idempotency_key,request_hash) VALUES(${eventId},${access.staff.organizationId},${parsed.data.centreId},${id.data},${eventType},${ciphertext},${access.staff.staffUserId},${key},${requestHash})`);
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: `doctor.${eventType.toLowerCase()}`, entityType: "doctor_profile", entityId: id.data, details: { eventType } });
      return { eventId, eventType, visitId: typeof privateData.visitId === "string" ? privateData.visitId : null, replayed: false };
    });
    return Response.json({ visitEvent: { id: outcome.eventId, visitId: outcome.visitId, type: outcome.eventType }, replayed: outcome.replayed }, { status: outcome.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const statuses: Record<string, number> = { idempotency_conflict: 409, doctor_not_found: 404, visit_plan_not_found: 404, visit_already_closed: 409, visit_already_checked_in: 409, visit_check_in_required: 409, checked_in_visit_cannot_be_cancelled: 409 };
    if (code in statuses) return Response.json({ error: code }, { status: statuses[code] });
    return Response.json({ error: "doctor_visit_unavailable" }, { status: 503 });
  }
}
