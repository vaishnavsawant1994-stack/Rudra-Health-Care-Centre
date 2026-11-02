import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres, staffShiftEvents, staffShifts, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { staffShiftPatchSchema } from "@/server/staff-roster-policy";
import { canReadTeamRoster } from "@/server/staff-roster-visibility";

const uuid = z.uuid();
const context = (orgId: string, centreId: string, id: string, type = "staff-shift") => operationalContext({ organizationId: orgId, centreId, recordId: id }, type);

export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const initial = await getApiAccess("workspace.read");
  if (initial.response) return initial.response;
  const [shift] = await getDb().select({ id: staffShifts.id, organizationId: staffShifts.organizationId, centreId: staffShifts.centreId, staffId: staffShifts.staffId, staffName: staffUsers.displayName, shiftType: staffShifts.shiftType, status: staffShifts.status, startsAt: staffShifts.startsAt, endsAt: staffShifts.endsAt, timeZone: staffShifts.timeZone, privateDataCiphertext: staffShifts.privateDataCiphertext, versionNumber: staffShifts.versionNumber, updatedAt: staffShifts.updatedAt }).from(staffShifts).innerJoin(staffUsers, and(eq(staffUsers.id, staffShifts.staffId), eq(staffUsers.organizationId, staffShifts.organizationId))).where(and(eq(staffShifts.id, id), eq(staffShifts.organizationId, initial.staff.organizationId))).limit(1);
  if (!shift) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("roster.read", shift.centreId);
  if (access.response) return Response.json({ error: "not_found" }, { status: 404 });
  if (!canReadTeamRoster(access.staff.grants, shift.centreId) && shift.staffId !== access.staff.staffUserId) return Response.json({ error: "not_found" }, { status: 404 });
  const events = await getDb().select({ id: staffShiftEvents.id, eventType: staffShiftEvents.eventType, actorName: staffUsers.displayName, privateDataCiphertext: staffShiftEvents.privateDataCiphertext, recordedAt: staffShiftEvents.recordedAt }).from(staffShiftEvents).innerJoin(staffUsers, and(eq(staffUsers.id, staffShiftEvents.actorStaffId), eq(staffUsers.organizationId, staffShiftEvents.organizationId))).where(and(eq(staffShiftEvents.organizationId, shift.organizationId), eq(staffShiftEvents.centreId, shift.centreId), eq(staffShiftEvents.shiftId, id))).orderBy(asc(staffShiftEvents.recordedAt));
  const { organizationId, centreId, privateDataCiphertext, ...publicShift } = shift;
  return Response.json({ shift: { ...publicShift, ...decryptOperationalData<{ note: string }>(privateDataCiphertext, context(organizationId, centreId, id)) }, history: events.map(({ id: eventId, privateDataCiphertext: envelope, ...event }) => ({ id: eventId, ...event, ...decryptOperationalData<Record<string, string>>(envelope, context(organizationId, centreId, eventId, "staff-shift-event")) })) });
}

export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await route.params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!uuid.safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = staffShiftPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_shift_action", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const initial = await getApiAccess("workspace.read");
  if (initial.response) return initial.response;
  const requestHash = createHash("sha256").update(JSON.stringify({ shiftId: id, action: parsed.data })).digest("hex");
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${initial.staff.organizationId}:roster-action-key:${idempotencyKey}`}, 0))`);
      const [shift] = await tx.select().from(staffShifts).where(and(eq(staffShifts.id, id), eq(staffShifts.organizationId, initial.staff.organizationId))).for("update").limit(1);
      if (!shift) throw new Error("not_found");
      const access = await getApiAccess("roster.manage", shift.centreId);
      if (access.response) throw new Error("forbidden");
      const [previousEvent] = await tx.select({ shiftId: staffShiftEvents.shiftId, eventType: staffShiftEvents.eventType, requestHash: staffShiftEvents.requestHash }).from(staffShiftEvents).where(and(eq(staffShiftEvents.organizationId, initial.staff.organizationId), eq(staffShiftEvents.idempotencyKey, idempotencyKey!))).limit(1);
      if (previousEvent) {
        if (previousEvent.shiftId !== id || previousEvent.requestHash !== requestHash) throw new Error("idempotency_conflict");
        return { id: previousEvent.shiftId, versionNumber: parsed.data.expectedVersion + 1, status: previousEvent.eventType === "CANCELLED" ? "CANCELLED" : "ACTIVE", replayed: true };
      }
      if (parsed.data.timeZone) {
        const [centre] = await tx.select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, shift.centreId), eq(centres.organizationId, shift.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
        if (!centre || parsed.data.timeZone !== centre.timeZone) throw new Error("centre_timezone_mismatch");
      }
      if (shift.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
      if (shift.status !== "ACTIVE") throw new Error("invalid_transition");
      const eventType: "UPDATED" | "CANCELLED" = parsed.data.action === "CANCEL" ? "CANCELLED" : "UPDATED";
      const set: Partial<typeof staffShifts.$inferInsert> = { versionNumber: shift.versionNumber + 1, updatedAt: new Date() };
      const current = decryptOperationalData<{ note: string }>(shift.privateDataCiphertext, context(shift.organizationId, shift.centreId, shift.id));
      if (parsed.data.action === "CANCEL") set.status = "CANCELLED";
      if (parsed.data.startsAt) set.startsAt = new Date(parsed.data.startsAt);
      if (parsed.data.endsAt) set.endsAt = new Date(parsed.data.endsAt);
      if (parsed.data.timeZone) set.timeZone = parsed.data.timeZone;
      if (parsed.data.note !== undefined) current.note = parsed.data.note;
      const startsAt = set.startsAt ?? shift.startsAt; const endsAt = set.endsAt ?? shift.endsAt;
      if (endsAt <= startsAt) throw new Error("invalid_time_range");
      if (parsed.data.action === "UPDATE") {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${shift.organizationId}:${shift.staffId}`}, 0))`);
        const [conflict] = await tx.select({ id: staffShifts.id }).from(staffShifts).where(and(eq(staffShifts.organizationId, shift.organizationId), eq(staffShifts.staffId, shift.staffId), eq(staffShifts.status, "ACTIVE"), sql`${staffShifts.id} <> ${shift.id}`, lt(staffShifts.startsAt, endsAt), gt(staffShifts.endsAt, startsAt))).limit(1);
        if (conflict) throw new Error("schedule_conflict");
        set.privateDataCiphertext = encryptOperationalData(current, context(shift.organizationId, shift.centreId, shift.id));
      }
      const [updated] = await tx.update(staffShifts).set(set).where(and(eq(staffShifts.id, shift.id), eq(staffShifts.versionNumber, shift.versionNumber))).returning({ id: staffShifts.id, versionNumber: staffShifts.versionNumber, status: staffShifts.status });
      if (!updated) throw new Error("version_conflict");
      const eventId = randomUUID();
      await tx.insert(staffShiftEvents).values({ id: eventId, organizationId: shift.organizationId, centreId: shift.centreId, shiftId: shift.id, eventType, privateDataCiphertext: encryptOperationalData({ reason: parsed.data.reason ?? null, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), note: current.note }, context(shift.organizationId, shift.centreId, eventId, "staff-shift-event")), actorStaffId: initial.staff.staffUserId, idempotencyKey: idempotencyKey!, requestHash });
      await appendAuditEvent(tx, { organizationId: shift.organizationId, centreId: shift.centreId, actorStaffId: initial.staff.staffUserId, action: `staff_shift.${eventType.toLowerCase()}`, entityType: "staff_shift", entityId: shift.id, details: { version: updated.versionNumber } });
      return { ...updated, replayed: false };
    });
    return Response.json({ shift: result });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const status = reason === "not_found" ? 404 : reason === "forbidden" ? 403 : ["version_conflict", "schedule_conflict", "invalid_transition", "idempotency_conflict"].includes(reason) ? 409 : ["invalid_time_range", "centre_timezone_mismatch"].includes(reason) ? 400 : 500;
    return Response.json({ error: status === 500 ? "shift_update_failed" : reason }, { status });
  }
}
