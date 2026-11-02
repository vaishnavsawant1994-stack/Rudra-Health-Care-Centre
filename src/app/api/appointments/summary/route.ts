import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getAppointmentReadAccess } from "@/server/appointment-access";
import { getDb } from "@/db/client";
import { appointments, centres } from "@/db/schema";
import { localDateTimeToUtc } from "@/server/appointment-policy";

export async function GET(request: Request) {
  const centreId = new URL(request.url).searchParams.get("centreId");
  if (!centreId || !z.uuid().safeParse(centreId).success) return Response.json({ error: "centre_required" }, { status: 400 });
  const access = await getAppointmentReadAccess(centreId);
  if (access.response) return access.response;
  const staff = access.staff!;
  const scoped = access.assignedOnly ? [eq(appointments.assignedStaffId, staff.staffUserId)] : [];
  const [centre] = await getDb().select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, centreId), eq(centres.organizationId, staff.organizationId))).limit(1);
  if (!centre) return Response.json({ error: "centre_not_found" }, { status: 404 });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: centre.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = localDateTimeToUtc(`${today}T00:00`, centre.timeZone);
  const tomorrow = new Date(`${today}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextDay = localDateTimeToUtc(`${tomorrow.toISOString().slice(0, 10)}T00:00`, centre.timeZone);
  if (!start || !nextDay) return Response.json({ error: "centre_time_zone_invalid" }, { status: 503 });
  const week = new Date(start.getTime() + 7 * 24 * 60 * 60_000);
  const [todayRows, upcomingRows] = await Promise.all([
    getDb().select({ status: appointments.status, count: sql<number>`count(*)::int` }).from(appointments).where(and(eq(appointments.organizationId, staff.organizationId), eq(appointments.centreId, centreId), ...scoped, gte(appointments.scheduledAt, start), lt(appointments.scheduledAt, nextDay))).groupBy(appointments.status),
    getDb().select({ count: sql<number>`count(*)::int` }).from(appointments).where(and(eq(appointments.organizationId, staff.organizationId), eq(appointments.centreId, centreId), ...scoped, gte(appointments.scheduledAt, nextDay), lt(appointments.scheduledAt, week), sql`${appointments.status} NOT IN ('CANCELLED','NO_SHOW')`)),
  ]);
  return Response.json({ date: today, timeZone: centre.timeZone, today: Object.fromEntries(todayRows.map((row) => [row.status, row.count])), upcomingSevenDays: upcomingRows[0]?.count ?? 0 });
}
