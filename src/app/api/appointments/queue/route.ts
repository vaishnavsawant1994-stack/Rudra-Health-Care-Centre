import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appointmentArrivalEvents, appointmentQueueEvents, appointmentQueueTokens, appointments, centres, patientContactSecrets, patients } from "@/db/schema";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { localDateTimeToUtc } from "@/server/appointment-policy";

const centreSchema = z.uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ISSUE"), centreId: z.uuid(), appointmentId: z.uuid() }),
  z.object({ action: z.literal("CALL_NEXT"), centreId: z.uuid() }),
]);
function centreLocalDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const centreId = url.searchParams.get("centreId");
  if (!centreSchema.safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page") ?? "1") || 1));
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") ?? "50") || 50));
  const access = await getApiAccess("appointments.read", centreId!);
  if (access.response) return access.response;
  const db = getDb();
  const [centre] = await db.select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, centreId!), eq(centres.organizationId, access.staff.organizationId))).limit(1);
  if (!centre) return Response.json({ error: "not_found" }, { status: 404 });
  const today = centreLocalDate(new Date(), centre.timeZone);
  const start = localDateTimeToUtc(`${today}T00:00`, centre.timeZone);
  const endDate = new Date(`${today}T00:00:00.000Z`); endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = localDateTimeToUtc(`${endDate.toISOString().slice(0, 10)}T00:00`, centre.timeZone);
  if (!start || !end) return Response.json({ error: "centre_timezone_unavailable" }, { status: 500 });
  const rows = await db.select({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, scheduledAt: appointments.scheduledAt, patientNumber: patients.patientNumber, patientId: patients.id, nameCiphertext: patientContactSecrets.nameCiphertext, encryptionKeyId: patientContactSecrets.encryptionKeyId, tokenId: appointmentQueueTokens.id, tokenNumber: appointmentQueueTokens.tokenNumber, queueStatus: appointmentQueueTokens.status, versionNumber: appointmentQueueTokens.versionNumber, issuedAt: appointmentQueueTokens.issuedAt, calledAt: appointmentQueueTokens.calledAt, actorStaffId: appointmentArrivalEvents.actorStaffId, arrivedAt: appointmentArrivalEvents.arrivedAt })
    .from(appointments).innerJoin(patients, and(eq(patients.id, appointments.patientId), eq(patients.organizationId, appointments.organizationId), eq(patients.centreId, appointments.centreId)))
    .innerJoin(patientContactSecrets, and(eq(patientContactSecrets.patientId, patients.id), eq(patientContactSecrets.organizationId, patients.organizationId), eq(patientContactSecrets.centreId, patients.centreId)))
    .innerJoin(appointmentArrivalEvents, and(eq(appointmentArrivalEvents.appointmentId, appointments.id), eq(appointmentArrivalEvents.organizationId, appointments.organizationId), eq(appointmentArrivalEvents.centreId, appointments.centreId), gte(appointmentArrivalEvents.arrivedAt, start), lt(appointmentArrivalEvents.arrivedAt, end)))
    .leftJoin(appointmentQueueTokens, and(eq(appointmentQueueTokens.appointmentId, appointments.id), eq(appointmentQueueTokens.organizationId, appointments.organizationId), eq(appointmentQueueTokens.centreId, appointments.centreId), eq(appointmentQueueTokens.queueDate, today)))
    .where(and(eq(appointments.organizationId, access.staff.organizationId), eq(appointments.centreId, centreId!), eq(appointments.bookingSource, "WALK_IN"), eq(appointments.visitType, "CENTRE"), inArray(appointments.status, ["CONFIRMED", "ASSIGNED", "RESCHEDULED"])))
    .orderBy(sql`${appointmentQueueTokens.tokenNumber} ASC NULLS LAST`, asc(appointmentArrivalEvents.arrivedAt), asc(appointments.id)).limit(pageSize + 1).offset((page - 1) * pageSize);
  const [waiting] = await db.select({ value: count() }).from(appointmentQueueTokens).where(and(eq(appointmentQueueTokens.organizationId, access.staff.organizationId), eq(appointmentQueueTokens.centreId, centreId!), eq(appointmentQueueTokens.queueDate, today), eq(appointmentQueueTokens.status, "WAITING")));
  const hasMore = rows.length > pageSize;
  if (hasMore) rows.pop();
  const walkIns = rows.map(({ nameCiphertext, encryptionKeyId, patientId, ...row }) => ({ ...row, ...(() => { const name = decryptPatientIdentity({ nameCiphertext, encryptionKeyId }, { organizationId: access.staff.organizationId, centreId: centreId!, patientId }); return { patientName: `${name.firstName} ${name.lastName}` }; })() }));
  return Response.json({ queueDate: today, timeZone: centre.timeZone, walkIns, pendingTokens: waiting.value, page, pageSize, hasMore });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const key = request.headers.get("idempotency-key");
  if (!z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_queue_action" }, { status: 400 });
  const access = await getApiAccess("appointments.update", parsed.data.centreId);
  if (access.response) return access.response;
  const db = getDb();
  const requestHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  let failureStage = "transaction_start";
  try {
    const result = await db.transaction(async (tx) => {
      failureStage = "idempotency_lock";
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:walk-in-queue:idempotency:${key}`}, 0))`);
      const [replay] = await tx.select().from(appointmentQueueTokens).where(and(eq(appointmentQueueTokens.organizationId, access.staff.organizationId), eq(appointmentQueueTokens.idempotencyKey, key!))).limit(1);
      if (replay) {
        if (replay.requestHash !== requestHash) throw new Error("idempotency_conflict");
        return { id: replay.id, appointmentId: replay.appointmentId, tokenNumber: replay.tokenNumber, queueDate: replay.queueDate, status: replay.status, versionNumber: replay.versionNumber, replayed: true };
      }
      const [priorEvent] = await tx.select({ id: appointmentQueueTokens.id, appointmentId: appointmentQueueTokens.appointmentId, tokenNumber: appointmentQueueTokens.tokenNumber, queueDate: appointmentQueueTokens.queueDate, status: appointmentQueueTokens.status, versionNumber: appointmentQueueTokens.versionNumber, requestHash: appointmentQueueEvents.requestHash, eventType: appointmentQueueEvents.eventType }).from(appointmentQueueEvents).innerJoin(appointmentQueueTokens, and(eq(appointmentQueueTokens.id, appointmentQueueEvents.queueTokenId), eq(appointmentQueueTokens.organizationId, appointmentQueueEvents.organizationId), eq(appointmentQueueTokens.centreId, appointmentQueueEvents.centreId))).where(and(eq(appointmentQueueEvents.organizationId, access.staff.organizationId), eq(appointmentQueueEvents.idempotencyKey, key!))).limit(1);
      if (priorEvent) {
        if (parsed.data.action !== "CALL_NEXT" || priorEvent.eventType !== "CALLED" || priorEvent.requestHash !== requestHash) throw new Error("idempotency_conflict");
        return { id: priorEvent.id, appointmentId: priorEvent.appointmentId, tokenNumber: priorEvent.tokenNumber, queueDate: priorEvent.queueDate, status: priorEvent.status, versionNumber: priorEvent.versionNumber, replayed: true };
      }
      const [centre] = await tx.select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, parsed.data.centreId), eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
      if (!centre) throw new Error("not_found");
      const queueDate = centreLocalDate(new Date(), centre.timeZone);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:walk-in-queue:${parsed.data.centreId}:${queueDate}`}, 0))`);
      if (parsed.data.action === "ISSUE") {
        failureStage = "appointment_lookup";
        const [appointment] = await tx.select({ id: appointments.id, status: appointments.status, bookingSource: appointments.bookingSource, visitType: appointments.visitType, scheduledAt: appointments.scheduledAt })
          .from(appointments).where(and(eq(appointments.id, parsed.data.appointmentId), eq(appointments.organizationId, access.staff.organizationId), eq(appointments.centreId, parsed.data.centreId))).for("update").limit(1);
        if (!appointment) throw new Error("not_found");
        if (appointment.bookingSource !== "WALK_IN" || appointment.visitType !== "CENTRE" || !["CONFIRMED", "ASSIGNED", "RESCHEDULED"].includes(appointment.status)) throw new Error("walk_in_not_queue_eligible");
        failureStage = "arrival_validation";
        const [arrival] = await tx.select({ id: appointmentArrivalEvents.id, arrivedAt: appointmentArrivalEvents.arrivedAt }).from(appointmentArrivalEvents).where(and(eq(appointmentArrivalEvents.organizationId, access.staff.organizationId), eq(appointmentArrivalEvents.centreId, parsed.data.centreId), eq(appointmentArrivalEvents.appointmentId, appointment.id))).limit(1);
        if (!arrival || centreLocalDate(arrival.arrivedAt, centre.timeZone) !== queueDate || centreLocalDate(appointment.scheduledAt, centre.timeZone) !== queueDate) throw new Error("walk_in_arrival_required");
        const [existing] = await tx.select({ id: appointmentQueueTokens.id }).from(appointmentQueueTokens).where(and(eq(appointmentQueueTokens.organizationId, access.staff.organizationId), eq(appointmentQueueTokens.appointmentId, appointment.id))).limit(1);
        if (existing) throw new Error("queue_token_exists");
        failureStage = "token_insert";
        const [next] = await tx.select({ value: sql<number>`coalesce(max(${appointmentQueueTokens.tokenNumber}), 0) + 1` }).from(appointmentQueueTokens).where(and(eq(appointmentQueueTokens.organizationId, access.staff.organizationId), eq(appointmentQueueTokens.centreId, parsed.data.centreId), eq(appointmentQueueTokens.queueDate, queueDate)));
        const id = randomUUID();
        const [token] = await tx.insert(appointmentQueueTokens).values({ id, organizationId: access.staff.organizationId, centreId: parsed.data.centreId, appointmentId: appointment.id, queueDate, tokenNumber: next.value, status: "WAITING", actorStaffId: access.staff.staffUserId, idempotencyKey: key!, requestHash }).returning();
        failureStage = "issue_event_audit";
        await tx.insert(appointmentQueueEvents).values({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, queueTokenId: id, eventType: "ISSUED", actorStaffId: access.staff.staffUserId, idempotencyKey: key!, requestHash });
        await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "appointment.queue_token_issued", entityType: "appointment_queue_token", entityId: id, details: { queueDate, tokenNumber: token.tokenNumber } });
        return { id, appointmentId: appointment.id, tokenNumber: token.tokenNumber, queueDate, status: token.status, versionNumber: token.versionNumber, replayed: false };
      }
      failureStage = "call_next_selection";
      const [waiting] = await tx.select({ id: appointmentQueueTokens.id, appointmentId: appointmentQueueTokens.appointmentId, tokenNumber: appointmentQueueTokens.tokenNumber, status: appointmentQueueTokens.status, versionNumber: appointmentQueueTokens.versionNumber }).from(appointmentQueueTokens).innerJoin(appointments, and(eq(appointments.id, appointmentQueueTokens.appointmentId), eq(appointments.organizationId, appointmentQueueTokens.organizationId), eq(appointments.centreId, appointmentQueueTokens.centreId))).where(and(eq(appointmentQueueTokens.organizationId, access.staff.organizationId), eq(appointmentQueueTokens.centreId, parsed.data.centreId), eq(appointmentQueueTokens.queueDate, queueDate), eq(appointmentQueueTokens.status, "WAITING"), eq(appointments.bookingSource, "WALK_IN"), eq(appointments.visitType, "CENTRE"), inArray(appointments.status, ["CONFIRMED", "ASSIGNED", "RESCHEDULED"]))).orderBy(asc(appointmentQueueTokens.tokenNumber)).for("update").limit(1);
      if (!waiting) throw new Error("queue_empty");
      const now = new Date();
      const [called] = await tx.update(appointmentQueueTokens).set({ status: "CALLED", calledAt: now, versionNumber: waiting.versionNumber + 1 }).where(and(eq(appointmentQueueTokens.id, waiting.id), eq(appointmentQueueTokens.versionNumber, waiting.versionNumber))).returning();
      await tx.insert(appointmentQueueEvents).values({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, queueTokenId: waiting.id, eventType: "CALLED", actorStaffId: access.staff.staffUserId, idempotencyKey: key!, requestHash });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "appointment.queue_token_called", entityType: "appointment_queue_token", entityId: waiting.id, details: { queueDate, tokenNumber: waiting.tokenNumber } });
      return { id: called.id, appointmentId: called.appointmentId, tokenNumber: called.tokenNumber, queueDate, status: called.status, versionNumber: called.versionNumber, replayed: false };
    });
    return Response.json({ token: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code !== "not_found" && !["idempotency_conflict", "queue_token_exists", "walk_in_arrival_required", "walk_in_not_queue_eligible", "queue_empty"].includes(code)) {
      const databaseError = error as { code?: unknown; constraint?: unknown; table?: unknown; column?: unknown; cause?: { code?: unknown; constraint?: unknown; table?: unknown; column?: unknown } };
      const cause = databaseError.cause;
      console.error("appointment_queue_action_failed", { stage: failureStage, errorType: error instanceof Error ? error.name : "UnknownError", databaseCode: typeof databaseError.code === "string" ? databaseError.code : typeof cause?.code === "string" ? cause.code : undefined, constraint: typeof databaseError.constraint === "string" ? databaseError.constraint : typeof cause?.constraint === "string" ? cause.constraint : undefined, table: typeof databaseError.table === "string" ? databaseError.table : typeof cause?.table === "string" ? cause.table : undefined, column: typeof databaseError.column === "string" ? databaseError.column : typeof cause?.column === "string" ? cause.column : undefined, causeType: cause instanceof Error ? cause.name : undefined });
    }
    const status = code === "not_found" ? 404 : ["idempotency_conflict", "queue_token_exists", "walk_in_arrival_required", "walk_in_not_queue_eligible", "queue_empty"].includes(code) ? 409 : 500;
    return Response.json({ error: status === 500 ? "queue_action_failed" : code }, { status });
  }
}
