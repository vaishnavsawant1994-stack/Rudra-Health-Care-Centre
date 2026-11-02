import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appointments, centres, patientContactSecrets, patients, staffUsers } from "@/db/schema";
import { listAssignableAppointmentStaff } from "@/server/appointment-access";
import { localDateTimeToUtc } from "@/server/appointment-policy";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";

const schema = z.object({ centreId: z.uuid(), date: z.iso.date(), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) });

export async function GET(request: Request) {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const access = await getApiAccess("appointments.assign", parsed.data.centreId);
  if (access.response) return access.response;
  const [centre] = await getDb().select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, parsed.data.centreId), eq(centres.organizationId, access.staff.organizationId))).limit(1);
  if (!centre) return Response.json({ error: "centre_not_found" }, { status: 404 });
  const start = localDateTimeToUtc(`${parsed.data.date}T00:00`, centre.timeZone);
  const nextDate = new Date(`${parsed.data.date}T00:00:00Z`); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = localDateTimeToUtc(`${nextDate.toISOString().slice(0, 10)}T00:00`, centre.timeZone);
  if (!start || !end) return Response.json({ error: "invalid_centre_time_zone" }, { status: 503 });
  const [rows, staff] = await Promise.all([
    getDb().select({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, patientId:patients.id,patientNumber: patients.patientNumber, encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,visitType: appointments.visitType, scheduledAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes, status: appointments.status, assignedStaffId: appointments.assignedStaffId, assignedStaffName: staffUsers.displayName })
      .from(appointments).innerJoin(patients, and(eq(patients.id, appointments.patientId), eq(patients.organizationId, appointments.organizationId), eq(patients.centreId, appointments.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).leftJoin(staffUsers, and(eq(staffUsers.id, appointments.assignedStaffId), eq(staffUsers.organizationId, appointments.organizationId))).where(and(eq(appointments.organizationId, access.staff.organizationId), eq(appointments.centreId, parsed.data.centreId), gte(appointments.scheduledAt, start), lt(appointments.scheduledAt, end))).orderBy(appointments.scheduledAt, appointments.id).limit(parsed.data.pageSize + 1).offset((parsed.data.page - 1) * parsed.data.pageSize),
    listAssignableAppointmentStaff(access.staff.organizationId, parsed.data.centreId),
  ]);
  const hasMore = rows.length > parsed.data.pageSize;
  const appointmentRows=rows.slice(0, parsed.data.pageSize).map(({encryptionKeyId,nameCiphertext,patientId,...row})=>{const name=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:access.staff.organizationId,centreId:parsed.data.centreId,patientId});return {...row,patientName:name.firstName,patientLastName:name.lastName};});
  return Response.json({ date: parsed.data.date, timeZone: centre.timeZone, appointments: appointmentRows, staff, page: parsed.data.page, pageSize: parsed.data.pageSize, hasMore });
}
