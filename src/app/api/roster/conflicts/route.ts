import { and, asc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appointments, collectionJobs, staffEscalations, staffShifts, staffUsers } from "@/db/schema";
import { collectionSummaryIsAssignedOnly } from "@/server/centre-operations-policy";
import { rosterAssignmentConflictFlags, type RosterShiftBlock } from "@/server/staff-roster-policy";
import { buildRosterConflictEscalationLinks } from "@/server/roster-escalation-links";

type ScheduledWork = { id: string; kind: "APPOINTMENT" | "COLLECTION"; label: string; staffId: string; staffName: string; startsAt: Date; endsAt: Date; centreId: string; versionNumber: number; expectedUpdatedAt: Date | null; flags: Set<string> };
const PAGE_SIZE = 100;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const centreId = params.get("centreId"); const from = params.get("from"); const to = params.get("to");
  const pageValue = params.get("page") ?? "1";
  if (!/^\d+$/.test(pageValue) || Number(pageValue) < 1 || Number(pageValue) > 100_000) return Response.json({ error: "invalid_page" }, { status: 400 });
  const page = Number(pageValue);
  if (!z.uuid().safeParse(centreId).success || !z.iso.datetime().safeParse(from).success || !z.iso.datetime().safeParse(to).success || Date.parse(to!) <= Date.parse(from!) || Date.parse(to!) - Date.parse(from!) > 31 * 86400000) return Response.json({ error: "invalid_conflict_range" }, { status: 400 });
  const access = await getApiAccess("roster.read", centreId!);
  if (access.response) return access.response;
  const orgId = access.staff.organizationId; const start = new Date(from!); const end = new Date(to!); const db = getDb();
  const scheduledRows = await db.select({ staffId: staffShifts.staffId, startsAt: staffShifts.startsAt, endsAt: staffShifts.endsAt, shiftType: staffShifts.shiftType }).from(staffShifts).where(and(eq(staffShifts.organizationId, orgId), eq(staffShifts.centreId, centreId!), eq(staffShifts.status, "ACTIVE"), lt(staffShifts.startsAt, end), gte(staffShifts.endsAt, start)));
  const work: ScheduledWork[] = []; let appointmentsHaveMore = false; let collectionsHaveMore = false;
  const appointmentAccess = await getApiAccess("appointments.read", centreId!);
  const appointmentAssigned = appointmentAccess.response ? await getApiAccess("appointments.assigned.read", centreId!) : null;
  const canReadAppointments = !appointmentAccess.response || !appointmentAssigned?.response;
  const appointmentsAssignedOnly = Boolean(appointmentAccess.response && canReadAppointments);
  if (canReadAppointments) {
    const assignedOnly = appointmentsAssignedOnly;
    const rows = await db.select({ id: appointments.id, number: appointments.appointmentNumber, status: appointments.status, staffId: appointments.assignedStaffId, staffName: staffUsers.displayName, startsAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes, updatedAt: appointments.updatedAt }).from(appointments).innerJoin(staffUsers, and(eq(staffUsers.id, appointments.assignedStaffId), eq(staffUsers.organizationId, appointments.organizationId))).where(and(eq(appointments.organizationId, orgId), eq(appointments.centreId, centreId!), inArray(appointments.status, ["REQUESTED", "CONFIRMED", "ASSIGNED", "RESCHEDULED"]), lt(appointments.scheduledAt, end), sql`${appointments.scheduledAt} + (${appointments.durationMinutes} * INTERVAL '1 minute') > ${start}`, sql`${appointments.assignedStaffId} IS NOT NULL`, assignedOnly ? eq(appointments.assignedStaffId, access.staff.staffUserId) : undefined)).orderBy(asc(appointments.scheduledAt), asc(appointments.id)).limit(PAGE_SIZE + 1).offset((page - 1) * PAGE_SIZE);
    appointmentsHaveMore = rows.length > PAGE_SIZE;
    for (const row of rows.slice(0, PAGE_SIZE)) if (row.staffId) work.push({ id: row.id, kind: "APPOINTMENT", label: row.number, staffId: row.staffId, staffName: row.staffName, startsAt: row.startsAt, endsAt: new Date(row.startsAt.getTime() + row.durationMinutes * 60_000), centreId: centreId!, versionNumber: 0, expectedUpdatedAt: row.updatedAt, flags: new Set() });
  }
  let collectionAccess = await getApiAccess("collections.read", centreId!);
  if (collectionAccess.response) collectionAccess = await getApiAccess("collections.assign", centreId!);
  const canReadCollections = !collectionAccess.response || access.staff.grants.some((grant) => grant.key === "collections.visit.record" && (grant.centreId === null || grant.centreId === centreId));
  const collectionsAssignedOnly = collectionSummaryIsAssignedOnly(access.staff.grants, centreId!);
  if (canReadCollections) {
    const assignedOnly = collectionsAssignedOnly;
    const rows = await db.select({ id: collectionJobs.id, number: collectionJobs.jobNumber, status: collectionJobs.status, staffId: collectionJobs.assignedStaffId, staffName: staffUsers.displayName, startsAt: collectionJobs.scheduledStart, endsAt: collectionJobs.scheduledEnd, versionNumber: collectionJobs.versionNumber }).from(collectionJobs).innerJoin(staffUsers, and(eq(staffUsers.id, collectionJobs.assignedStaffId), eq(staffUsers.organizationId, collectionJobs.organizationId))).where(and(eq(collectionJobs.organizationId, orgId), eq(collectionJobs.centreId, centreId!), inArray(collectionJobs.status, ["PENDING_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS"]), lt(collectionJobs.scheduledStart, end), gt(collectionJobs.scheduledEnd, start), sql`${collectionJobs.assignedStaffId} IS NOT NULL`, assignedOnly ? eq(collectionJobs.assignedStaffId, access.staff.staffUserId) : undefined)).orderBy(asc(collectionJobs.scheduledStart), asc(collectionJobs.id)).limit(PAGE_SIZE + 1).offset((page - 1) * PAGE_SIZE);
    collectionsHaveMore = rows.length > PAGE_SIZE;
    for (const row of rows.slice(0, PAGE_SIZE)) if (row.staffId) work.push({ id: row.id, kind: "COLLECTION", label: row.number, staffId: row.staffId, staffName: row.staffName, startsAt: row.startsAt, endsAt: row.endsAt, centreId: centreId!, versionNumber: row.versionNumber, expectedUpdatedAt: null, flags: new Set() });
  }
  const shiftBlocks = scheduledRows.filter((row): row is typeof row & { shiftType: "SCHEDULED" | "UNAVAILABLE" } => row.shiftType === "SCHEDULED" || row.shiftType === "UNAVAILABLE") as RosterShiftBlock[];
  const overlapping = new Set<string>();
  if (work.length) {
    const currentRows = sql.join(work.map((item) => sql`(${item.kind}::text, ${item.id}::uuid, ${item.staffId}::uuid, ${item.startsAt}::timestamptz, ${item.endsAt}::timestamptz)`), sql`, `);
    const appointmentOverlap = canReadAppointments ? sql`EXISTS (
      SELECT 1 FROM appointments peer
      WHERE peer.organization_id = ${orgId} AND peer.centre_id = ${centreId!}
        AND peer.status IN ('REQUESTED','CONFIRMED','ASSIGNED','RESCHEDULED')
        AND peer.assigned_staff_id = current.staff_id
        AND peer.scheduled_at < current.ends_at
        AND peer.scheduled_at + (peer.duration_minutes * INTERVAL '1 minute') > current.starts_at
        AND NOT (current.kind = 'APPOINTMENT' AND peer.id = current.id)
        ${appointmentsAssignedOnly ? sql`AND peer.assigned_staff_id = ${access.staff.staffUserId}` : sql``}
    )` : sql`false`;
    const collectionOverlap = canReadCollections ? sql`EXISTS (
      SELECT 1 FROM collection_jobs peer
      WHERE peer.organization_id = ${orgId} AND peer.centre_id = ${centreId!}
        AND peer.status IN ('PENDING_ASSIGNMENT','ASSIGNED','IN_PROGRESS')
        AND peer.assigned_staff_id = current.staff_id
        AND peer.scheduled_start < current.ends_at AND peer.scheduled_end > current.starts_at
        AND NOT (current.kind = 'COLLECTION' AND peer.id = current.id)
        ${collectionsAssignedOnly ? sql`AND peer.assigned_staff_id = ${access.staff.staffUserId}` : sql``}
    )` : sql`false`;
    const overlapResult = await db.execute(sql`
      WITH current_work(kind, id, staff_id, starts_at, ends_at) AS (VALUES ${currentRows})
      SELECT current.kind, current.id
      FROM current_work current
      WHERE ${appointmentOverlap} OR ${collectionOverlap}
    `);
    for (const row of overlapResult.rows as Array<{ kind: string; id: string }>) overlapping.add(`${row.kind}:${row.id}`);
  }
  const detected = rosterAssignmentConflictFlags(work, shiftBlocks);
  const conflictMap = new Map(detected.map((item) => [`${item.kind}:${item.id}`, item]));
  for (const item of work) {
    const key = `${item.kind}:${item.id}`;
    if (overlapping.has(key) && !conflictMap.has(key)) conflictMap.set(key, { ...item, advisoryFlags: ["OVERLAPPING_ASSIGNMENT"] });
    else if (overlapping.has(key)) conflictMap.set(key, { ...conflictMap.get(key)!, advisoryFlags: [...conflictMap.get(key)!.advisoryFlags.filter((flag) => flag !== "OVERLAPPING_ASSIGNMENT"), "OVERLAPPING_ASSIGNMENT"] });
  }
  const conflicts = [...conflictMap.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).map((item) => { const source = work.find((row) => row.id === item.id && row.kind === item.kind)!; return { id: item.id, kind: item.kind, label: item.label, staffId: item.staffId, staffName: item.staffName, startsAt: item.startsAt, endsAt: item.endsAt, centreId: item.centreId, versionNumber: source.versionNumber, expectedUpdatedAt: source.expectedUpdatedAt?.toISOString() ?? null, advisoryFlags: item.advisoryFlags }; });
  if (conflicts.length) {
    let escalationAccess = await getApiAccess("escalations.read", centreId!);
    let assignedOnly = false;
    if (escalationAccess.response) {
      escalationAccess = await getApiAccess("escalations.assigned.read", centreId!);
      assignedOnly = true;
    }
    if (!escalationAccess.response) {
      const appointmentIds = conflicts.filter((item) => item.kind === "APPOINTMENT").map((item) => item.id);
      const collectionIds = conflicts.filter((item) => item.kind === "COLLECTION").map((item) => item.id);
      const sourceFilters = [
        appointmentIds.length ? and(eq(staffEscalations.sourceType, "APPOINTMENT"), inArray(staffEscalations.sourceId, appointmentIds)) : undefined,
        collectionIds.length ? and(eq(staffEscalations.sourceType, "COLLECTION_JOB"), inArray(staffEscalations.sourceId, collectionIds)) : undefined,
      ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
      if (sourceFilters.length) {
        const rows = await db.select({ id: staffEscalations.id, sourceType: staffEscalations.sourceType, sourceId: staffEscalations.sourceId })
          .from(staffEscalations)
          .where(and(eq(staffEscalations.organizationId, orgId), eq(staffEscalations.centreId, centreId!), inArray(staffEscalations.status, ["OPEN", "ACKNOWLEDGED"]), or(...sourceFilters)!, assignedOnly ? eq(staffEscalations.assignedOwnerStaffId, access.staff.staffUserId) : undefined))
          .orderBy(asc(staffEscalations.createdAt), asc(staffEscalations.id));
        const links = buildRosterConflictEscalationLinks(conflicts, rows);
        for (const conflict of conflicts) {
          const sourceType = conflict.kind === "APPOINTMENT" ? "APPOINTMENT" : "COLLECTION_JOB";
          const relatedEscalationId = links.get(`${sourceType}:${conflict.id}`);
          if (relatedEscalationId) Object.assign(conflict, { relatedEscalationId });
        }
      }
    }
  }
  return Response.json({ from: start.toISOString(), to: end.toISOString(), conflicts, page, pageSize: PAGE_SIZE, hasMore: appointmentsHaveMore || collectionsHaveMore, advisoryOnly: true });
}
