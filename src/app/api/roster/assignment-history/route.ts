import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";
import { getAppointmentReadAccess } from "@/server/appointment-access";
import { getCollectionReadAccess, collectionAssignmentVisibility } from "@/server/collection-access";
import { assignmentVisibilityAtCentre } from "@/server/assignment-visibility";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const centreId = params.get("centreId");
  const from = params.get("from");
  const to = params.get("to");
  const pageText = params.get("page") ?? "1";
  const page = /^\d{1,5}$/.test(pageText) ? Number(pageText) : 0;

  if (!z.uuid().safeParse(centreId).success
    || !z.iso.datetime().safeParse(from).success
    || !z.iso.datetime().safeParse(to).success
    || Date.parse(to!) <= Date.parse(from!)
    || Date.parse(to!) - Date.parse(from!) > 31 * 86400000) {
    return Response.json({ error: "invalid_history_range" }, { status: 400 });
  }
  if (!page || page > 1000) return Response.json({ error: "invalid_page" }, { status: 400 });

  const rosterAccess = await getApiAccess("roster.read", centreId!);
  if (rosterAccess.response) return rosterAccess.response;

  const [appointmentAccess, collectionAccess] = await Promise.all([
    getAppointmentReadAccess(centreId!),
    getCollectionReadAccess(centreId!),
  ]);
  const canReadAppointments = !appointmentAccess.response && Boolean(appointmentAccess.staff);
  const collectionVisibility = collectionAccess.response || !collectionAccess.staff
    ? null
    : assignmentVisibilityAtCentre(collectionAssignmentVisibility(collectionAccess.staff.grants), centreId!);
  const canReadCollections = collectionVisibility !== null && collectionVisibility !== "none";

  if (!canReadAppointments && !canReadCollections) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const appointmentFilter = !canReadAppointments
    ? sql`WHERE false`
    : sql`WHERE h.organization_id = ${rosterAccess.staff.organizationId} AND h.centre_id = ${centreId}
      AND h.recorded_at >= ${new Date(from!)} AND h.recorded_at < ${new Date(to!)}
      AND h.action IN ('ASSIGNED', 'REASSIGNED', 'UNASSIGNED')
      ${appointmentAccess.assignedOnly ? sql`AND (h.staff_id = ${appointmentAccess.staff!.staffUserId} OR h.previous_staff_id = ${appointmentAccess.staff!.staffUserId} OR h.actor_staff_id = ${appointmentAccess.staff!.staffUserId})` : sql``}`;
  const collectionFilter = !canReadCollections
    ? sql`WHERE false`
    : collectionVisibility === "assigned"
      ? sql`AND (e.staff_id = ${collectionAccess.staff!.staffUserId} OR e.previous_staff_id = ${collectionAccess.staff!.staffUserId} OR e.actor_staff_id = ${collectionAccess.staff!.staffUserId})`
      : sql``;

  const result = await getDb().execute(sql`
    WITH assignment_events AS (
      SELECT h.id, 'APPOINTMENT'::text AS work_type, a.appointment_number AS work_reference,
        h.action AS action, previous_staff.display_name AS previous_staff_name,
        assigned_staff.display_name AS staff_name, actor.display_name AS actor_name,
        h.recorded_at
      FROM appointment_assignment_history h
      INNER JOIN appointments a
        ON a.id = h.appointment_id AND a.organization_id = h.organization_id AND a.centre_id = h.centre_id
      LEFT JOIN staff_users assigned_staff
        ON assigned_staff.id = h.staff_id AND assigned_staff.organization_id = h.organization_id
      LEFT JOIN staff_users previous_staff
        ON previous_staff.id = h.previous_staff_id AND previous_staff.organization_id = h.organization_id
      INNER JOIN staff_users actor
        ON actor.id = h.actor_staff_id AND actor.organization_id = h.organization_id
      ${appointmentFilter}
      UNION ALL
      SELECT e.id, 'COLLECTION'::text AS work_type, j.job_number AS work_reference,
        e.event_type AS action, previous_staff.display_name AS previous_staff_name,
        assigned_staff.display_name AS staff_name, actor.display_name AS actor_name,
        e.recorded_at
      FROM collection_job_events e
      INNER JOIN collection_jobs j
        ON j.id = e.job_id AND j.organization_id = e.organization_id AND j.centre_id = e.centre_id
      LEFT JOIN staff_users assigned_staff
        ON assigned_staff.id = e.staff_id AND assigned_staff.organization_id = e.organization_id
      LEFT JOIN staff_users previous_staff
        ON previous_staff.id = e.previous_staff_id AND previous_staff.organization_id = e.organization_id
      INNER JOIN staff_users actor
        ON actor.id = e.actor_staff_id AND actor.organization_id = e.organization_id
      WHERE ${canReadCollections}
        AND e.organization_id = ${rosterAccess.staff.organizationId} AND e.centre_id = ${centreId}
        AND e.recorded_at >= ${new Date(from!)} AND e.recorded_at < ${new Date(to!)}
        AND e.event_type IN ('ASSIGNED', 'REASSIGNED', 'UNASSIGNED')
        ${collectionFilter}
    )
    SELECT id, work_type AS "workType", work_reference AS "workReference", action,
      previous_staff_name AS "previousStaffName", staff_name AS "staffName",
      actor_name AS "actorName", recorded_at AS "recordedAt"
    FROM assignment_events
    ORDER BY recorded_at DESC, id DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}
  `);
  const rows = result.rows as Array<{ id: string; workType: "APPOINTMENT" | "COLLECTION"; workReference: string; action: string; previousStaffName: string | null; staffName: string | null; actorName: string; recordedAt: Date | string }>;
  const hasMore = rows.length > PAGE_SIZE;
  return Response.json({
    events: rows.slice(0, PAGE_SIZE).map((row) => ({ ...row, recordedAt: new Date(row.recordedAt).toISOString() })),
    page,
    pageSize: PAGE_SIZE,
    hasMore,
  }, { headers: { "cache-control": "no-store" } });
}
