import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appointments, centres, patientContactSecrets, patients } from "@/db/schema";
import { getAppointmentReadAccess } from "@/server/appointment-access";
import { localDateTimeToUtc } from "@/server/appointment-policy";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";

const schema = z.object({ centreId: z.uuid(), date: z.iso.date(), view: z.enum(["day", "week", "month"]).default("week"), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) });

export async function GET(request: Request) {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const access = await getAppointmentReadAccess(parsed.data.centreId);
  if (access.response) return access.response;
  const staff = access.staff!;
  const [centre] = await getDb().select({ timeZone: centres.timeZone, name: centres.name }).from(centres).where(and(eq(centres.id, parsed.data.centreId), eq(centres.organizationId, staff.organizationId))).limit(1);
  if (!centre) return Response.json({ error: "centre_not_found" }, { status: 404 });
  const next = new Date(`${parsed.data.date}T00:00:00Z`);
  if (parsed.data.view === "day") next.setUTCDate(next.getUTCDate() + 1);
  else if (parsed.data.view === "week") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  const start = localDateTimeToUtc(`${parsed.data.date}T00:00`, centre.timeZone);
  const end = localDateTimeToUtc(`${next.toISOString().slice(0, 10)}T00:00`, centre.timeZone);
  if (!start || !end) return Response.json({ error: "invalid_centre_time_zone" }, { status: 503 });
  const assignedOnly = access.assignedOnly;
  const rows = await getDb().select({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, patientId:patients.id,patientNumber: patients.patientNumber, encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,centreName: centres.name, centreId: centres.id, visitType: appointments.visitType, scheduledAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes, timeZone: appointments.timeZone, status: appointments.status })
    .from(appointments).innerJoin(patients, and(eq(patients.id, appointments.patientId), eq(patients.organizationId, appointments.organizationId), eq(patients.centreId, appointments.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).innerJoin(centres, and(eq(centres.id, appointments.centreId), eq(centres.organizationId, appointments.organizationId)))
    .where(and(eq(appointments.organizationId, staff.organizationId), eq(appointments.centreId, parsed.data.centreId), ...(assignedOnly ? [eq(appointments.assignedStaffId, staff.staffUserId)] : []), gte(appointments.scheduledAt, start), lt(appointments.scheduledAt, end))).orderBy(appointments.scheduledAt, appointments.id).limit(parsed.data.pageSize + 1).offset((parsed.data.page - 1) * parsed.data.pageSize);
  const hasMore = rows.length > parsed.data.pageSize;
  const appointmentRows=rows.slice(0, parsed.data.pageSize).map(({encryptionKeyId,nameCiphertext,patientId,...row})=>{const name=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:staff.organizationId,centreId:row.centreId,patientId});return {...row,patientName:name.firstName,patientLastName:name.lastName};});
  return Response.json({ date: parsed.data.date, view: parsed.data.view, timeZone: centre.timeZone, centreName: centre.name, appointments: appointmentRows, page: parsed.data.page, pageSize: parsed.data.pageSize, hasMore });
}
