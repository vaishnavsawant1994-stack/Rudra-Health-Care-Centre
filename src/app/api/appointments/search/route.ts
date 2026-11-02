import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appointmentArrivalEvents, appointments, centres, patientContactSecrets, patients, staffUsers } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { getAppointmentReadAccess } from "@/server/appointment-access";
import { appointmentPermission, visibleAppointmentCentres } from "@/server/appointment-policy";
import { blindIndexPatientName, decryptPatientIdentity } from "@/server/patient-contact-crypto";

const schema = z.object({ q: z.string().trim().max(80).default(""), centreId: z.uuid().nullable().optional(), status: z.enum(["REQUESTED", "CONFIRMED", "ASSIGNED", "RESCHEDULED", "CANCELLED", "NO_SHOW"]).nullable().optional(), source: z.enum(["STAFF", "WALK_IN", "LEAD", "PATIENT_PORTAL", "PHONE", "WEBSITE"]).nullable().optional(), visitType: z.enum(["CENTRE", "HOME_COLLECTION"]).nullable().optional(), awaitingArrival: z.boolean().default(false), page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(50).default(25) });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  if (new URL(request.url).searchParams.has("q")) return Response.json({ error: "search_requires_post_body" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.q.length > 0 && parsed.data.q.length < 2)) return Response.json({ error: "invalid_search" }, { status: 400 });
  const centreId = parsed.data.centreId ?? undefined;
  const access = await getAppointmentReadAccess(centreId);
  if (access.response) return access.response;
  const { staff, assignedOnly } = access;
  const permission = assignedOnly ? "appointments.assigned.read" : "appointments.read";
  const scopes = visibleAppointmentCentres(staff.grants, permission);
  if (centreId && scopes !== null && !scopes.includes(centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  const conditions = [eq(appointments.organizationId, staff.organizationId)];
  if (centreId) conditions.push(eq(appointments.centreId, centreId)); else if (scopes !== null) conditions.push(inArray(appointments.centreId, scopes));
  if (assignedOnly) conditions.push(eq(appointments.assignedStaffId, staff.staffUserId));
  if (parsed.data.status) conditions.push(eq(appointments.status, parsed.data.status));
  if (parsed.data.source) conditions.push(eq(appointments.bookingSource, parsed.data.source));
  if (parsed.data.visitType) conditions.push(eq(appointments.visitType, parsed.data.visitType));
  if (parsed.data.awaitingArrival) {
    conditions.push(
      eq(appointments.visitType, "CENTRE"),
      inArray(appointments.status, ["CONFIRMED", "ASSIGNED", "RESCHEDULED"]),
      sql`${appointmentArrivalEvents.id} IS NULL`,
      sql`${appointments.scheduledAt} >= date_trunc('day', now() AT TIME ZONE ${centres.timeZone}) AT TIME ZONE ${centres.timeZone}`,
      sql`${appointments.scheduledAt} < (date_trunc('day', now() AT TIME ZONE ${centres.timeZone}) + interval '1 day') AT TIME ZONE ${centres.timeZone}`,
    );
  }
  if (parsed.data.q) {
    const q = `%${parsed.data.q.replace(/[%_]/g, "\\$&")}%`;
    const query=parsed.data.q.trim();
    conditions.push(or(ilike(appointments.appointmentNumber, q), ilike(patients.patientNumber, q),eq(patientContactSecrets.firstNameBlindIndex,blindIndexPatientName("first",query)),eq(patientContactSecrets.lastNameBlindIndex,blindIndexPatientName("last",query)),eq(patientContactSecrets.fullNameBlindIndex,blindIndexPatientName("full",query)))!);
  }
  const db = getDb();
  const assignedStaff = alias(staffUsers, "appointment_search_assignee");
  const [countRows, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(appointments).innerJoin(patients, and(eq(patients.id, appointments.patientId), eq(patients.organizationId, appointments.organizationId), eq(patients.centreId, appointments.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).innerJoin(centres, and(eq(centres.id, appointments.centreId), eq(centres.organizationId, appointments.organizationId))).leftJoin(appointmentArrivalEvents, and(eq(appointmentArrivalEvents.appointmentId, appointments.id), eq(appointmentArrivalEvents.organizationId, appointments.organizationId), eq(appointmentArrivalEvents.centreId, appointments.centreId))).where(and(...conditions)),
    db.select({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, patientId: patients.id, patientNumber: patients.patientNumber, encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,centreId: centres.id, centreName: centres.name, visitType: appointments.visitType, scheduledAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes, timeZone: appointments.timeZone, status: appointments.status, assignedStaffId: appointments.assignedStaffId, staffName: assignedStaff.displayName, homeChargeChoice: appointments.homeChargeChoice, homeChargeRupees: appointments.homeChargeRupees, arrivalAt: appointmentArrivalEvents.arrivedAt })
      .from(appointments).innerJoin(patients, and(eq(patients.id, appointments.patientId), eq(patients.organizationId, appointments.organizationId), eq(patients.centreId, appointments.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).innerJoin(centres, and(eq(centres.id, appointments.centreId), eq(centres.organizationId, appointments.organizationId))).leftJoin(assignedStaff, and(eq(assignedStaff.id, appointments.assignedStaffId), eq(assignedStaff.organizationId, appointments.organizationId))).leftJoin(appointmentArrivalEvents, and(eq(appointmentArrivalEvents.appointmentId, appointments.id), eq(appointmentArrivalEvents.organizationId, appointments.organizationId), eq(appointmentArrivalEvents.centreId, appointments.centreId))).where(and(...conditions)).orderBy(appointments.scheduledAt).limit(parsed.data.pageSize).offset((parsed.data.page - 1) * parsed.data.pageSize),
  ]);
  const appointmentRows=rows.map(({encryptionKeyId,nameCiphertext,patientId,centreId,...row})=>{const name=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:staff.organizationId,centreId,patientId});return {...row,patientId,centreId,patientName:`${name.firstName} ${name.lastName}`,canCheckIn: row.arrivalAt === null && row.visitType === "CENTRE" && ["CONFIRMED","ASSIGNED","RESCHEDULED"].includes(row.status) && appointmentPermission(staff.grants,"appointments.update",centreId)};});
  return Response.json({ appointments: appointmentRows, total: countRows[0]?.count ?? 0, page: parsed.data.page, pageSize: parsed.data.pageSize });
}
