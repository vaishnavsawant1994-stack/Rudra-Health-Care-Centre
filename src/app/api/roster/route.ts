import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres, staffRoleAssignments, staffShifts, staffShiftEvents, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { staffShiftSchema } from "@/server/staff-roster-policy";
import { canReadTeamRoster, teamRosterCentreScope } from "@/server/staff-roster-visibility";
import { legacyShiftCreateFingerprint, sameShiftPrivateNote, shiftCreateFingerprint } from "@/server/staff-roster-idempotency";

const uuid = z.uuid();
const SHIFT_PAGE_SIZE = 100;
const context = (orgId: string, centreId: string, id: string, type = "staff-shift") => operationalContext({ organizationId: orgId, centreId, recordId: id }, type);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pageValue = params.get("page") ?? "1";
  if (!/^\d+$/.test(pageValue) || Number(pageValue) < 1 || Number(pageValue) > 100_000) return Response.json({ error: "invalid_page" }, { status: 400 });
  const page = Number(pageValue);
  const centreId = params.get("centreId");
  const staffId = params.get("staffId");
  const from = params.get("from"); const to = params.get("to");
  if ((centreId && !uuid.safeParse(centreId).success) || (staffId && !uuid.safeParse(staffId).success) || (from && !z.iso.datetime().safeParse(from).success) || (to && !z.iso.datetime().safeParse(to).success) || (from && to && Date.parse(from) >= Date.parse(to))) return Response.json({ error: "invalid_filter" }, { status: 400 });
  const access = await getApiAccess("roster.read", centreId ?? undefined);
  if (access.response) return access.response;
  const teamScope = teamRosterCentreScope(access.staff.grants);
  const teamView = centreId ? canReadTeamRoster(access.staff.grants, centreId) : teamScope === null;
  const grants = access.staff.grants.filter((grant) => grant.key === "roster.read" || grant.key === "roster.manage");
  const allCentres = grants.some((grant) => grant.centreId === null);
  const centreScope = [...new Set(grants.map((grant) => grant.centreId).filter((id): id is string => id !== null))];
  const where = [eq(staffShifts.organizationId, access.staff.organizationId), eq(staffShifts.status, "ACTIVE")];
  if (centreId) where.push(eq(staffShifts.centreId, centreId));
  else if (!allCentres) where.push(inArray(staffShifts.centreId, centreScope));
  if (centreId) {
    if (staffId && !teamView && staffId !== access.staff.staffUserId) return Response.json({ error: "not_found" }, { status: 404 });
    if (staffId) where.push(eq(staffShifts.staffId, staffId));
    else if (!teamView) where.push(eq(staffShifts.staffId, access.staff.staffUserId));
  } else if (staffId === access.staff.staffUserId) {
    where.push(eq(staffShifts.staffId, access.staff.staffUserId));
  } else if (staffId) {
    if (teamScope !== null) {
      if (!teamScope.length) return Response.json({ error: "not_found" }, { status: 404 });
      where.push(inArray(staffShifts.centreId, teamScope));
    }
    where.push(eq(staffShifts.staffId, staffId));
  } else if (teamScope !== null) {
    const visibleRows = [eq(staffShifts.staffId, access.staff.staffUserId)];
    if (teamScope.length) visibleRows.push(inArray(staffShifts.centreId, teamScope));
    where.push(or(...visibleRows)!);
  }
  if (from) where.push(gte(staffShifts.endsAt, new Date(from)));
  if (to) where.push(lte(staffShifts.startsAt, new Date(to)));
  const rows = await getDb().select({ id: staffShifts.id, organizationId: staffShifts.organizationId, centreId: staffShifts.centreId, staffId: staffShifts.staffId, staffName: staffUsers.displayName, shiftType: staffShifts.shiftType, startsAt: staffShifts.startsAt, endsAt: staffShifts.endsAt, timeZone: staffShifts.timeZone, privateDataCiphertext: staffShifts.privateDataCiphertext, versionNumber: staffShifts.versionNumber, createdAt: staffShifts.createdAt }).from(staffShifts).innerJoin(staffUsers, and(eq(staffUsers.id, staffShifts.staffId), eq(staffUsers.organizationId, staffShifts.organizationId))).where(and(...where)).orderBy(asc(staffShifts.startsAt), asc(staffShifts.id)).limit(SHIFT_PAGE_SIZE + 1).offset((page - 1) * SHIFT_PAGE_SIZE);
  const hasMore = rows.length > SHIFT_PAGE_SIZE;
  const shifts = rows.slice(0, SHIFT_PAGE_SIZE).map(({ privateDataCiphertext, organizationId, centreId: rowCentreId, id, ...row }) => ({ ...row, ...decryptOperationalData<{ note: string }>(privateDataCiphertext, context(organizationId, rowCentreId, id)) }));
  return Response.json({ shifts, page, pageSize: SHIFT_PAGE_SIZE, hasMore });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!uuid.safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = staffShiftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_shift", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("roster.manage", parsed.data.centreId);
  if (access.response) return access.response;
  const staff = access.staff; const input = parsed.data;
  const [centre] = await getDb().select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, input.centreId), eq(centres.organizationId, staff.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
  if (!centre || input.timeZone !== centre.timeZone) return Response.json({ error: "centre_timezone_mismatch" }, { status: 400 });
  const [member] = await getDb().select({ id: staffUsers.id }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt))).where(and(eq(staffUsers.id, input.staffId), eq(staffUsers.organizationId, staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, input.centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
  if (!member) return Response.json({ error: "staff_member_not_found" }, { status: 400 });
  const requestHash = shiftCreateFingerprint(input); const legacyRequestHash = legacyShiftCreateFingerprint(input); const id = randomUUID();
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${staff.organizationId}:roster-key:${idempotencyKey}`}, 0))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${staff.organizationId}:${input.staffId}`}, 0))`);
      const [existing] = await tx.select({ id: staffShifts.id, centreId: staffShifts.centreId, staffId: staffShifts.staffId, requestHash: staffShifts.requestHash, privateDataCiphertext: staffShifts.privateDataCiphertext }).from(staffShifts).where(and(eq(staffShifts.organizationId, staff.organizationId), eq(staffShifts.idempotencyKey, idempotencyKey!))).limit(1);
      if (existing) {
        if ((existing.requestHash !== requestHash && existing.requestHash !== legacyRequestHash) || existing.centreId !== input.centreId || existing.staffId !== input.staffId) throw new Error("idempotency_conflict");
        const storedShift = decryptOperationalData<{ note: string }>(existing.privateDataCiphertext, context(staff.organizationId, existing.centreId, existing.id));
        if (!sameShiftPrivateNote(storedShift, input.note)) throw new Error("idempotency_conflict");
        return { id: existing.id, replayed: true };
      }
      const [conflict] = await tx.select({ id: staffShifts.id }).from(staffShifts).where(and(eq(staffShifts.organizationId, staff.organizationId), eq(staffShifts.staffId, input.staffId), eq(staffShifts.status, "ACTIVE"), lt(staffShifts.startsAt, new Date(input.endsAt)), gt(staffShifts.endsAt, new Date(input.startsAt)))).limit(1);
      if (conflict) throw new Error("schedule_conflict");
      await tx.insert(staffShifts).values({ id, organizationId: staff.organizationId, centreId: input.centreId, staffId: input.staffId, shiftType: input.shiftType, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), timeZone: input.timeZone, privateDataCiphertext: encryptOperationalData({ note: input.note }, context(staff.organizationId, input.centreId, id)), createdByStaffId: staff.staffUserId, idempotencyKey: idempotencyKey!, requestHash });
      const eventId = randomUUID();
      await tx.insert(staffShiftEvents).values({ id: eventId, organizationId: staff.organizationId, centreId: input.centreId, shiftId: id, eventType: "CREATED", privateDataCiphertext: encryptOperationalData({ shiftType: input.shiftType, startsAt: input.startsAt, endsAt: input.endsAt, note: input.note }, context(staff.organizationId, input.centreId, eventId, "staff-shift-event")), actorStaffId: staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: staff.organizationId, centreId: input.centreId, actorStaffId: staff.staffUserId, action: "staff_shift.created", entityType: "staff_shift", entityId: id, details: { shiftType: input.shiftType } });
      return { id, replayed: false };
    });
    return Response.json({ shift: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const conflict = message === "schedule_conflict";
    const replayConflict = message === "idempotency_conflict";
    return Response.json({ error: conflict ? "schedule_conflict" : replayConflict ? "idempotency_conflict" : "shift_creation_failed" }, { status: conflict || replayConflict ? 409 : 500 });
  }
}
