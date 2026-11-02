import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appointmentArrivalEvents, appointments } from "@/db/schema";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canReceptionCheckIn } from "@/server/appointment-arrival-policy";

type Context = { params: Promise<{ id: string }> };
const inputSchema = z.object({ arrivalConfirmed: z.literal(true) });

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!z.uuid().safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "arrival_confirmation_required" }, { status: 400 });
  const base = await getApiAccess("workspace.read");
  if (base.response) return base.response;
  const db = getDb();
  const [initial] = await db.select({ id: appointments.id, organizationId: appointments.organizationId, centreId: appointments.centreId, visitType: appointments.visitType })
    .from(appointments).where(and(eq(appointments.id, id), eq(appointments.organizationId, base.staff.organizationId))).limit(1);
  if (!initial) return Response.json({ error: "not_found" }, { status: 404 });
  if (initial.visitType !== "CENTRE") return Response.json({ error: "front_desk_checkin_not_applicable" }, { status: 409 });
  const access = await getApiAccess("appointments.update", initial.centreId);
  if (access.response) return access.response;
  const requestHash = createHash("sha256").update(JSON.stringify({ appointmentId: id, arrivalConfirmed: parsed.data.arrivalConfirmed })).digest("hex");
  try {
    const arrival = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${initial.organizationId}:appointment-arrival:${idempotencyKey}`}, 0))`);
      const [replay] = await tx.select().from(appointmentArrivalEvents).where(and(eq(appointmentArrivalEvents.organizationId, initial.organizationId), eq(appointmentArrivalEvents.idempotencyKey, idempotencyKey!))).limit(1);
      if (replay) {
        if (replay.requestHash !== requestHash || replay.appointmentId !== id) throw new Error("idempotency_conflict");
        return { id: replay.id, appointmentId: replay.appointmentId, arrivedAt: replay.arrivedAt, replayed: true };
      }
      const [appointment] = await tx.select({ id: appointments.id, status: appointments.status, visitType: appointments.visitType }).from(appointments)
        .where(and(eq(appointments.id, id), eq(appointments.organizationId, initial.organizationId), eq(appointments.centreId, initial.centreId)))
        .for("update").limit(1);
      if (!appointment) throw new Error("not_found");
      if (appointment.visitType !== "CENTRE") throw new Error("front_desk_checkin_not_applicable");
      if (!canReceptionCheckIn(appointment.status)) throw new Error("appointment_not_ready_for_check_in");
      const [existing] = await tx.select({ id: appointmentArrivalEvents.id }).from(appointmentArrivalEvents)
        .where(and(eq(appointmentArrivalEvents.organizationId, initial.organizationId), eq(appointmentArrivalEvents.appointmentId, id))).limit(1);
      if (existing) throw new Error("arrival_already_recorded");
      const arrivalId = randomUUID();
      const [created] = await tx.insert(appointmentArrivalEvents).values({ id: arrivalId, organizationId: initial.organizationId, centreId: initial.centreId, appointmentId: id, actorStaffId: access.staff.staffUserId, idempotencyKey: idempotencyKey!, requestHash }).returning({ id: appointmentArrivalEvents.id, appointmentId: appointmentArrivalEvents.appointmentId, arrivedAt: appointmentArrivalEvents.arrivedAt });
      await appendAuditEvent(tx, { organizationId: initial.organizationId, centreId: initial.centreId, actorStaffId: access.staff.staffUserId, action: "appointment.arrival_recorded", entityType: "appointment_arrival", entityId: arrivalId, details: {} });
      return { ...created, replayed: false };
    });
    return Response.json({ arrival }, { status: arrival.replayed ? 200 : 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const status = reason === "not_found" ? 404 : reason === "arrival_already_recorded" || reason === "idempotency_conflict" || reason === "appointment_not_ready_for_check_in" || reason === "front_desk_checkin_not_applicable" ? 409 : 500;
    return Response.json({ error: status === 500 ? "arrival_recording_failed" : reason }, { status });
  }
}
