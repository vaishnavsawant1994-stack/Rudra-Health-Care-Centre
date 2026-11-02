import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { staffShiftHandoverEvents, staffShiftHandovers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { handoverActionFingerprint, legacyHandoverActionFingerprint, sameHandoverActionReason } from "@/server/staff-roster-idempotency";

const uuid = z.uuid();
const patchSchema = z.object({ centreId: uuid, expectedVersion: z.number().int().positive(), action: z.enum(["ACKNOWLEDGE", "CANCEL"]), reason: z.string().trim().min(3).max(500).optional() }).superRefine((value, context) => {
  if (value.action === "CANCEL" && !value.reason) context.addIssue({ code: "custom", path: ["reason"], message: "A cancellation reason is required." });
});
const eventContext = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "staff-shift-handover-event");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "handover_not_found" }, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_handover_action", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("roster.handover", parsed.data.centreId);
  if (access.response) return access.response;
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!uuid.safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const staff = access.staff;
  const manager = staff.grants.some((grant) => grant.key === "roster.manage" && (grant.centreId === parsed.data.centreId || grant.centreId === null));
  const requestHash = handoverActionFingerprint(id, parsed.data);
  const legacyRequestHash = legacyHandoverActionFingerprint(id, parsed.data);
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${staff.organizationId}:handover-action:${idempotencyKey}`}, 0))`);
      const [priorEvent] = await tx.select().from(staffShiftHandoverEvents).where(and(eq(staffShiftHandoverEvents.organizationId, staff.organizationId), eq(staffShiftHandoverEvents.idempotencyKey, idempotencyKey!))).limit(1);
      if (priorEvent) {
        const [current] = await tx.select().from(staffShiftHandovers).where(and(eq(staffShiftHandovers.id, id), eq(staffShiftHandovers.organizationId, staff.organizationId), eq(staffShiftHandovers.centreId, parsed.data.centreId))).limit(1);
        const expectedEvent = parsed.data.action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "CANCELLED";
        const authorizedReplay = parsed.data.action === "ACKNOWLEDGE" ? current?.incomingStaffId === staff.staffUserId : current?.outgoingStaffId === staff.staffUserId || manager;
        if (!current || priorEvent.handoverId !== id || priorEvent.actorStaffId !== staff.staffUserId || priorEvent.eventType !== expectedEvent || (priorEvent.requestHash !== requestHash && priorEvent.requestHash !== legacyRequestHash) || !authorizedReplay) throw new Error("idempotency_conflict");
        if (priorEvent.requestHash === requestHash) {
          const privateEvent = decryptOperationalData<{ reason?: string }>(priorEvent.privateDataCiphertext, eventContext(priorEvent.organizationId, priorEvent.centreId, priorEvent.id));
          const expectedReason = parsed.data.reason ?? "Incoming staff member acknowledged receipt.";
          if (!sameHandoverActionReason(privateEvent, expectedReason)) throw new Error("idempotency_conflict");
        }
        return { id: current.id, status: current.status, versionNumber: current.versionNumber, replayed: true };
      }
      const [handover] = await tx.select().from(staffShiftHandovers).where(and(eq(staffShiftHandovers.id, id), eq(staffShiftHandovers.organizationId, staff.organizationId), eq(staffShiftHandovers.centreId, parsed.data.centreId))).for("update").limit(1);
      if (!handover) throw new Error("handover_not_found");
      if (handover.versionNumber !== parsed.data.expectedVersion) throw new Error("stale_handover");
      if (handover.status !== "PENDING") throw new Error("handover_not_pending");
      if (parsed.data.action === "ACKNOWLEDGE" && (staff.staffUserId !== handover.incomingStaffId || staff.staffUserId === handover.outgoingStaffId)) throw new Error("handover_acknowledgment_forbidden");
      if (parsed.data.action === "CANCEL" && staff.staffUserId !== handover.outgoingStaffId && !manager) throw new Error("handover_cancel_forbidden");
      const eventType = parsed.data.action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "CANCELLED";
      await tx.update(staffShiftHandovers).set({ status: parsed.data.action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "CANCELLED", versionNumber: sql`${staffShiftHandovers.versionNumber} + 1`, ...(parsed.data.action === "ACKNOWLEDGE" ? { acknowledgedByStaffId: staff.staffUserId, acknowledgedAt: new Date() } : {}), updatedAt: new Date() }).where(eq(staffShiftHandovers.id, handover.id));
      const eventId = randomUUID();
      await tx.insert(staffShiftHandoverEvents).values({ id: eventId, organizationId: staff.organizationId, centreId: handover.centreId, handoverId: handover.id, eventType, privateDataCiphertext: encryptOperationalData({ reason: parsed.data.reason ?? "Incoming staff member acknowledged receipt." }, eventContext(staff.organizationId, handover.centreId, eventId)), actorStaffId: staff.staffUserId, idempotencyKey: idempotencyKey!, requestHash });
      await appendAuditEvent(tx, { organizationId: staff.organizationId, centreId: handover.centreId, actorStaffId: staff.staffUserId, action: `staff_shift_handover.${eventType.toLowerCase()}`, entityType: "staff_shift_handover", entityId: handover.id, details: { status: parsed.data.action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "CANCELLED" } });
      return { id: handover.id, status: parsed.data.action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "CANCELLED", versionNumber: handover.versionNumber + 1, replayed: false };
    });
    return Response.json({ handover: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "handover_not_found" ? 404 : ["stale_handover", "handover_not_pending", "idempotency_conflict"].includes(message) ? 409 : ["handover_acknowledgment_forbidden", "handover_cancel_forbidden"].includes(message) ? 403 : 409;
    return Response.json({ error: ["handover_not_found", "stale_handover", "handover_not_pending", "handover_acknowledgment_forbidden", "handover_cancel_forbidden", "idempotency_conflict"].includes(message) ? message : "handover_action_failed" }, { status });
  }
}
