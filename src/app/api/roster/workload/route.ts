import { and, count, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appointments, centres, collectionJobs, staffRoleAssignments, staffShifts, staffTasks, staffUsers } from "@/db/schema";
import { canReadTeamRoster } from "@/server/staff-roster-visibility";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const centreId = params.get("centreId"); const from = params.get("from"); const to = params.get("to");
  if (!z.uuid().safeParse(centreId).success || !z.iso.datetime().safeParse(from).success || !z.iso.datetime().safeParse(to).success || Date.parse(to!) <= Date.parse(from!) || Date.parse(to!) - Date.parse(from!) > 31 * 86400000) return Response.json({ error: "invalid_workload_range" }, { status: 400 });
  const access = await getApiAccess("roster.read", centreId!);
  if (access.response) return access.response;
  const db = getDb(); const orgId = access.staff.organizationId; const start = new Date(from!); const end = new Date(to!);
  const teamView = canReadTeamRoster(access.staff.grants, centreId!);
  const [centre] = await db.select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, centreId!), eq(centres.organizationId, orgId))).limit(1);
  if (!centre) return Response.json({ error: "not_found" }, { status: 404 });
  const members = await db.selectDistinct({ id: staffUsers.id, name: staffUsers.displayName, staffCode: staffUsers.staffCode }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt))).where(and(eq(staffUsers.organizationId, orgId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, centreId!), isNull(staffRoleAssignments.centreId)), ...(teamView ? [] : [eq(staffUsers.id, access.staff.staffUserId)])));
  const appointmentWhere = and(eq(appointments.organizationId, orgId), eq(appointments.centreId, centreId!), lt(appointments.scheduledAt, end), sql`${appointments.scheduledAt} + (${appointments.durationMinutes} * INTERVAL '1 minute') > ${start}`, inArray(appointments.status, ["REQUESTED", "CONFIRMED", "ASSIGNED", "RESCHEDULED"]), sql`${appointments.assignedStaffId} IS NOT NULL`, ...(teamView ? [] : [eq(appointments.assignedStaffId, access.staff.staffUserId)]));
  const collectionWhere = and(eq(collectionJobs.organizationId, orgId), eq(collectionJobs.centreId, centreId!), lt(collectionJobs.scheduledStart, end), gt(collectionJobs.scheduledEnd, start), inArray(collectionJobs.status, ["PENDING_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS"]), sql`${collectionJobs.assignedStaffId} IS NOT NULL`, ...(teamView ? [] : [eq(collectionJobs.assignedStaffId, access.staff.staffUserId)]));
  const appointmentHasNoCoveringShift = sql`NOT EXISTS (SELECT 1 FROM staff_shifts s WHERE s.organization_id = ${appointments.organizationId} AND s.centre_id = ${appointments.centreId} AND s.staff_id = ${appointments.assignedStaffId} AND s.status = 'ACTIVE' AND s.shift_type = 'SCHEDULED' AND s.starts_at <= ${appointments.scheduledAt} AND s.ends_at >= ${appointments.scheduledAt} + (${appointments.durationMinutes} * INTERVAL '1 minute'))`;
  const collectionHasNoCoveringShift = sql`NOT EXISTS (SELECT 1 FROM staff_shifts s WHERE s.organization_id = ${collectionJobs.organizationId} AND s.centre_id = ${collectionJobs.centreId} AND s.staff_id = ${collectionJobs.assignedStaffId} AND s.status = 'ACTIVE' AND s.shift_type = 'SCHEDULED' AND s.starts_at <= ${collectionJobs.scheduledStart} AND s.ends_at >= ${collectionJobs.scheduledEnd})`;
  const appointmentOverlapsUnavailability = sql`EXISTS (SELECT 1 FROM staff_shifts s WHERE s.organization_id = ${appointments.organizationId} AND s.centre_id = ${appointments.centreId} AND s.staff_id = ${appointments.assignedStaffId} AND s.status = 'ACTIVE' AND s.shift_type = 'UNAVAILABLE' AND s.starts_at < ${appointments.scheduledAt} + (${appointments.durationMinutes} * INTERVAL '1 minute') AND s.ends_at > ${appointments.scheduledAt})`;
  const collectionOverlapsUnavailability = sql`EXISTS (SELECT 1 FROM staff_shifts s WHERE s.organization_id = ${collectionJobs.organizationId} AND s.centre_id = ${collectionJobs.centreId} AND s.staff_id = ${collectionJobs.assignedStaffId} AND s.status = 'ACTIVE' AND s.shift_type = 'UNAVAILABLE' AND s.starts_at < ${collectionJobs.scheduledEnd} AND s.ends_at > ${collectionJobs.scheduledStart})`;
  const shiftWindow = and(eq(staffShifts.organizationId, orgId), eq(staffShifts.centreId, centreId!), eq(staffShifts.status, "ACTIVE"), lt(staffShifts.startsAt, end), gt(staffShifts.endsAt, start), ...(teamView ? [] : [eq(staffShifts.staffId, access.staff.staffUserId)]));
  const [appointmentCounts, collectionCounts, taskCounts, appointmentOutsideShift, collectionOutsideShift, appointmentUnavailable, collectionUnavailable, scheduledRoster, unavailablePeriods] = await Promise.all([
    db.select({ staffId: appointments.assignedStaffId, value: count() }).from(appointments).where(appointmentWhere).groupBy(appointments.assignedStaffId),
    db.select({ staffId: collectionJobs.assignedStaffId, value: count() }).from(collectionJobs).where(collectionWhere).groupBy(collectionJobs.assignedStaffId),
    db.select({ staffId: staffTasks.assignedStaffId, value: count() }).from(staffTasks).where(and(eq(staffTasks.organizationId, orgId), eq(staffTasks.centreId, centreId!), inArray(staffTasks.status, ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"]), or(isNull(staffTasks.dueAt), lte(staffTasks.dueAt, end)), ...(teamView ? [] : [eq(staffTasks.assignedStaffId, access.staff.staffUserId)]))).groupBy(staffTasks.assignedStaffId),
    db.select({ staffId: appointments.assignedStaffId, value: count() }).from(appointments).where(and(appointmentWhere, appointmentHasNoCoveringShift)).groupBy(appointments.assignedStaffId),
    db.select({ staffId: collectionJobs.assignedStaffId, value: count() }).from(collectionJobs).where(and(collectionWhere, collectionHasNoCoveringShift)).groupBy(collectionJobs.assignedStaffId),
    db.select({ staffId: appointments.assignedStaffId, value: count() }).from(appointments).where(and(appointmentWhere, appointmentOverlapsUnavailability)).groupBy(appointments.assignedStaffId),
    db.select({ staffId: collectionJobs.assignedStaffId, value: count() }).from(collectionJobs).where(and(collectionWhere, collectionOverlapsUnavailability)).groupBy(collectionJobs.assignedStaffId),
    db.select({ staffId: staffShifts.staffId, value: sql<number>`COALESCE(sum(EXTRACT(EPOCH FROM (LEAST(${staffShifts.endsAt}, ${end}) - GREATEST(${staffShifts.startsAt}, ${start}))) / 60)::int, 0)` }).from(staffShifts).where(and(shiftWindow, eq(staffShifts.shiftType, "SCHEDULED"))).groupBy(staffShifts.staffId),
    db.select({ staffId: staffShifts.staffId, value: count() }).from(staffShifts).where(and(shiftWindow, eq(staffShifts.shiftType, "UNAVAILABLE"))).groupBy(staffShifts.staffId),
  ]);
  const countMap = (rows: Array<{ staffId: string | null; value: number }>) => new Map(rows.flatMap((row) => row.staffId ? [[row.staffId, row.value] as const] : []));
  const a = countMap(appointmentCounts); const c = countMap(collectionCounts); const t = countMap(taskCounts);
  const aos = countMap(appointmentOutsideShift); const cos = countMap(collectionOutsideShift); const au = countMap(appointmentUnavailable); const cu = countMap(collectionUnavailable); const rosterMinutes = countMap(scheduledRoster); const unavailable = countMap(unavailablePeriods);
  const [dailyAppointments, dailyCollections] = await Promise.all([
    db.select({ staffId: appointments.assignedStaffId, day: sql<string>`to_char(GREATEST(${appointments.scheduledAt}, ${start}) AT TIME ZONE ${centre.timeZone}, 'YYYY-MM-DD')`, value: count() }).from(appointments).where(appointmentWhere).groupBy(sql`1`, sql`2`),
    db.select({ staffId: collectionJobs.assignedStaffId, day: sql<string>`to_char(GREATEST(${collectionJobs.scheduledStart}, ${start}) AT TIME ZONE ${centre.timeZone}, 'YYYY-MM-DD')`, value: count() }).from(collectionJobs).where(collectionWhere).groupBy(sql`1`, sql`2`),
  ]);
  const daily = new Map<string, { staffId: string; day: string; appointments: number; collections: number }>();
  for (const row of dailyAppointments) if (row.staffId) { const key = `${row.staffId}:${row.day}`; daily.set(key, { staffId: row.staffId, day: row.day, appointments: row.value, collections: 0 }); }
  for (const row of dailyCollections) if (row.staffId) { const key = `${row.staffId}:${row.day}`; const entry = daily.get(key) ?? { staffId: row.staffId, day: row.day, appointments: 0, collections: 0 }; entry.collections = row.value; daily.set(key, entry); }
  return Response.json({ from: start.toISOString(), to: end.toISOString(), dailyWorkload: [...daily.values()].sort((left, right) => left.day.localeCompare(right.day) || left.staffId.localeCompare(right.staffId)), staff: members.map((member) => ({ ...member, appointments: a.get(member.id) ?? 0, collections: c.get(member.id) ?? 0, openTasks: t.get(member.id) ?? 0, scheduledMinutes: rosterMinutes.get(member.id) ?? 0, unavailablePeriods: unavailable.get(member.id) ?? 0, appointmentsOutsideRoster: aos.get(member.id) ?? 0, collectionsOutsideRoster: cos.get(member.id) ?? 0, assignmentsDuringUnavailability: (au.get(member.id) ?? 0) + (cu.get(member.id) ?? 0) })) });
}
