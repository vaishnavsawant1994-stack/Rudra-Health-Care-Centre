import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appointments, diagnosticOrders, patientContactSecrets, patients } from "@/db/schema";
import { visibleAppointmentCentres } from "@/server/appointment-policy";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";

export async function GET() {
  const access = await getApiAccess("collections.assign"); if (access.response) return access.response;
  const scope = visibleAppointmentCentres(access.staff.grants, "collections.assign");
  const filters = [eq(appointments.organizationId, access.staff.organizationId), inArray(appointments.status, ["CONFIRMED", "ASSIGNED"]), eq(diagnosticOrders.status, "CONFIRMED"), sql`NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE j.organization_id=${appointments.organizationId} AND j.order_id=${diagnosticOrders.id})`];
  if (scope !== null) filters.push(scope.length ? inArray(appointments.centreId, scope) : eq(appointments.centreId, "00000000-0000-0000-0000-000000000000"));
  const rows = await getDb().select({ appointmentId: appointments.id, appointmentNumber: appointments.appointmentNumber, orderId: diagnosticOrders.id, orderNumber: diagnosticOrders.orderNumber, centreId: appointments.centreId, patientId: appointments.patientId, encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,visitType: appointments.visitType, scheduledAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes }).from(appointments).innerJoin(diagnosticOrders, and(eq(diagnosticOrders.appointmentId, appointments.id), eq(diagnosticOrders.organizationId, appointments.organizationId), eq(diagnosticOrders.centreId, appointments.centreId))).innerJoin(patients, and(eq(patients.id, appointments.patientId), eq(patients.organizationId, appointments.organizationId), eq(patients.centreId, appointments.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(...filters)).orderBy(asc(appointments.scheduledAt)).limit(200);
  const eligible=rows.map(({encryptionKeyId,nameCiphertext,patientId,centreId,...row})=>{const name=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:access.staff.organizationId,centreId,patientId});return {...row,patientId,centreId,patientName:name.firstName,patientLastName:name.lastName};});
  return Response.json({ eligible });
}
