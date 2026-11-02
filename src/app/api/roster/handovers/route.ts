import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { permissions, rolePermissions, roles, staffRoleAssignments, staffShiftHandoverEvents, staffShiftHandovers, staffShifts, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { handoverCreateFingerprint, legacyHandoverCreateFingerprint, sameHandoverPrivateNote } from "@/server/staff-roster-idempotency";

const uuid = z.uuid();
const HANDOVER_PAGE_SIZE = 50;
const createSchema = z.object({ centreId: uuid, outgoingShiftId: uuid, incomingStaffId: uuid, handoverNote: z.string().trim().min(3).max(2000) });
const handoverContext = (organizationId: string, centreId: string, recordId: string, kind = "staff-shift-handover") => operationalContext({ organizationId, centreId, recordId }, kind);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const centreId = params.get("centreId");
  if (!centreId || !uuid.safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const pageValue = params.get("page") ?? "1";
  if (!/^\d+$/.test(pageValue) || Number(pageValue) < 1 || Number(pageValue) > 100_000) return Response.json({ error: "invalid_page" }, { status: 400 });
  const page = Number(pageValue);
  const access = await getApiAccess("roster.handover", centreId);
  if (access.response) return access.response;
  const staff = access.staff;
  const manager = staff.grants.some((grant) => grant.key === "roster.manage" && (grant.centreId === centreId || grant.centreId === null));
  const db = getDb();
  const scope = [eq(staffShifts.organizationId, staff.organizationId), eq(staffShifts.centreId, centreId), eq(staffShifts.status, "ACTIVE")];
  if (!manager) scope.push(eq(staffShifts.staffId, staff.staffUserId));
  const shifts = await db.select({ id: staffShifts.id, staffId: staffShifts.staffId, shiftType: staffShifts.shiftType, startsAt: staffShifts.startsAt, endsAt: staffShifts.endsAt })
    .from(staffShifts).where(and(...scope)).orderBy(desc(staffShifts.startsAt)).limit(100);
  const incomingStaff = await db.selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode })
    .from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
    .innerJoin(roles, and(eq(roles.id, staffRoleAssignments.roleId), eq(roles.organizationId, staffRoleAssignments.organizationId)))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "roster.handover")))
    .where(and(eq(staffUsers.organizationId, staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, centreId), isNull(staffRoleAssignments.centreId)))).orderBy(asc(staffUsers.displayName)).limit(200);
  const handoverWhere = [eq(staffShiftHandovers.organizationId, staff.organizationId), eq(staffShiftHandovers.centreId, centreId)];
  if (!manager) handoverWhere.push(or(eq(staffShiftHandovers.outgoingStaffId, staff.staffUserId), eq(staffShiftHandovers.incomingStaffId, staff.staffUserId))!);
  const pageRows = await db.select().from(staffShiftHandovers).where(and(...handoverWhere)).orderBy(desc(staffShiftHandovers.createdAt), desc(staffShiftHandovers.id)).limit(HANDOVER_PAGE_SIZE + 1).offset((page - 1) * HANDOVER_PAGE_SIZE);
  const hasMore = pageRows.length > HANDOVER_PAGE_SIZE;
  const rows = pageRows.slice(0, HANDOVER_PAGE_SIZE);
  const events = rows.length ? await db.select().from(staffShiftHandoverEvents).where(and(eq(staffShiftHandoverEvents.organizationId, staff.organizationId), eq(staffShiftHandoverEvents.centreId, centreId), inArray(staffShiftHandoverEvents.handoverId, rows.map((row) => row.id)))).orderBy(asc(staffShiftHandoverEvents.recordedAt), asc(staffShiftHandoverEvents.id)) : [];
  const handovers = rows.map((row) => ({ id: row.id, centreId: row.centreId, outgoingShiftId: row.outgoingShiftId, outgoingStaffId: row.outgoingStaffId, incomingStaffId: row.incomingStaffId, status: row.status, versionNumber: row.versionNumber, acknowledgedByStaffId: row.acknowledgedByStaffId, acknowledgedAt: row.acknowledgedAt, createdAt: row.createdAt, ...decryptOperationalData<{ handoverNote: string }>(row.privateDataCiphertext, handoverContext(row.organizationId, row.centreId, row.id)), history: events.filter((event) => event.handoverId === row.id).map((event) => ({ id: event.id, eventType: event.eventType, actorStaffId: event.actorStaffId, recordedAt: event.recordedAt, ...decryptOperationalData<Record<string, string>>(event.privateDataCiphertext, handoverContext(event.organizationId, event.centreId, event.id, "staff-shift-handover-event")) })) }));
  return Response.json({ handovers, page, pageSize: HANDOVER_PAGE_SIZE, hasMore, shifts, incomingStaff, canManage: manager });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const key = request.headers.get("idempotency-key");
  if (!uuid.safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_handover", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("roster.handover", parsed.data.centreId);
  if (access.response) return access.response;
  const staff = access.staff;
  const manager = staff.grants.some((grant) => grant.key === "roster.manage" && (grant.centreId === parsed.data.centreId || grant.centreId === null));
  const requestHash = handoverCreateFingerprint(parsed.data);
  const legacyRequestHash = legacyHandoverCreateFingerprint(parsed.data);
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${staff.organizationId}:shift-handover:${key}`}, 0))`);
      const [existing] = await tx.select({ id: staffShiftHandovers.id, centreId: staffShiftHandovers.centreId, requestHash: staffShiftHandovers.requestHash, privateDataCiphertext: staffShiftHandovers.privateDataCiphertext, outgoingStaffId: staffShiftHandovers.outgoingStaffId, incomingStaffId: staffShiftHandovers.incomingStaffId }).from(staffShiftHandovers).where(and(eq(staffShiftHandovers.organizationId, staff.organizationId), eq(staffShiftHandovers.idempotencyKey, key!))).limit(1);
      if (existing) {
        if ((existing.requestHash !== requestHash && existing.requestHash !== legacyRequestHash) || existing.centreId !== parsed.data.centreId) throw new Error("idempotency_conflict");
        const storedPrivate = decryptOperationalData<{ handoverNote: string }>(existing.privateDataCiphertext, handoverContext(staff.organizationId, existing.centreId, existing.id));
        if (!sameHandoverPrivateNote(storedPrivate, parsed.data.handoverNote)) throw new Error("idempotency_conflict");
        if (!manager && existing.outgoingStaffId !== staff.staffUserId && existing.incomingStaffId !== staff.staffUserId) throw new Error("forbidden");
        return { id: existing.id, replayed: true };
      }
      const [shift] = await tx.select({ id: staffShifts.id, staffId: staffShifts.staffId, status: staffShifts.status }).from(staffShifts).where(and(eq(staffShifts.id, parsed.data.outgoingShiftId), eq(staffShifts.organizationId, staff.organizationId), eq(staffShifts.centreId, parsed.data.centreId))).for("update").limit(1);
      if (!shift || shift.status !== "ACTIVE" || (shift.staffId !== staff.staffUserId && !manager)) throw new Error("outgoing_shift_unavailable");
      if (shift.staffId === parsed.data.incomingStaffId) throw new Error("handover_self_assignment");
      const [incoming] = await tx.select({ id: staffUsers.id }).from(staffUsers)
        .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
        .innerJoin(roles, and(eq(roles.id, staffRoleAssignments.roleId), eq(roles.organizationId, staffRoleAssignments.organizationId)))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "roster.handover")))
        .where(and(eq(staffUsers.id, parsed.data.incomingStaffId), eq(staffUsers.organizationId, staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, parsed.data.centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
      if (!incoming) throw new Error("incoming_staff_unavailable");
      const id = randomUUID();
      await tx.insert(staffShiftHandovers).values({ id, organizationId: staff.organizationId, centreId: parsed.data.centreId, outgoingShiftId: shift.id, outgoingStaffId: shift.staffId, incomingStaffId: parsed.data.incomingStaffId, privateDataCiphertext: encryptOperationalData({ handoverNote: parsed.data.handoverNote }, handoverContext(staff.organizationId, parsed.data.centreId, id)), idempotencyKey: key!, requestHash, createdByStaffId: staff.staffUserId });
      const eventId = randomUUID();
      await tx.insert(staffShiftHandoverEvents).values({ id: eventId, organizationId: staff.organizationId, centreId: parsed.data.centreId, handoverId: id, eventType: "PREPARED", privateDataCiphertext: encryptOperationalData({ note: "Handover prepared for incoming staff acknowledgment." }, handoverContext(staff.organizationId, parsed.data.centreId, eventId, "staff-shift-handover-event")), actorStaffId: staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: staff.organizationId, centreId: parsed.data.centreId, actorStaffId: staff.staffUserId, action: "staff_shift_handover.prepared", entityType: "staff_shift_handover", entityId: id, details: { status: "PENDING" } });
      return { id, replayed: false };
    });
    return Response.json({ handover: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = ["forbidden", "idempotency_conflict", "outgoing_shift_unavailable", "handover_self_assignment", "incoming_staff_unavailable"].includes(message) ? message : "handover_create_failed";
    const status = code === "forbidden" ? 403 : code === "handover_create_failed" || code === "idempotency_conflict" ? 409 : 400;
    return Response.json({ error: code }, { status });
  }
}
