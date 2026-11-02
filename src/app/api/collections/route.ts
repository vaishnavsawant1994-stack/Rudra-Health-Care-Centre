import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { collectionAssignmentVisibility, getCollectionReadAccess } from "@/server/collection-access";
import { getDb } from "@/db/client";
import { appointments, centres, collectionJobEvents, collectionJobs, diagnosticOrders, patientContactSecrets, patients } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { collectionJobCreateSchema } from "@/server/sample-policy";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { isValidScheduleDate } from "@/server/collection-schedule-policy";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 50);
  if (!Number.isInteger(page) || page < 1 || page > 10_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return Response.json({ error: "invalid_pagination" }, { status: 400 });
  const scheduleDate = params.get("date");
  if (scheduleDate !== null && !isValidScheduleDate(scheduleDate)) return Response.json({ error: "invalid_schedule_date" }, { status: 400 });
  const access = await getCollectionReadAccess();
  if (access.response) return access.response;
  const { staff } = access;
  const visibility = collectionAssignmentVisibility(staff.grants);
  const scope = visibility.readCentres;
  const clauses = [eq(collectionJobs.organizationId, staff.organizationId)];
  if (scope !== null) clauses.push(scope.length ? inArray(collectionJobs.centreId, scope) : eq(collectionJobs.centreId, "00000000-0000-0000-0000-000000000000"));
  if (visibility.restricted) {
    const permitted = [];
    if (visibility.unrestrictedCentres?.length) permitted.push(inArray(collectionJobs.centreId, visibility.unrestrictedCentres));
    if (visibility.assignedOnlyCentres === null) permitted.push(eq(collectionJobs.assignedStaffId, staff.staffUserId));
    else if (visibility.assignedOnlyCentres.length) permitted.push(and(inArray(collectionJobs.centreId, visibility.assignedOnlyCentres), eq(collectionJobs.assignedStaffId, staff.staffUserId)));
    clauses.push(permitted.length ? or(...permitted)! : eq(collectionJobs.id, "00000000-0000-0000-0000-000000000000"));
  }
  if (scheduleDate) clauses.push(sql`(${collectionJobs.scheduledStart} AT TIME ZONE ${centres.timeZone})::date = ${scheduleDate}::date`);
  const summaryRows = await getDb().select({ status: collectionJobs.status, count: count() }).from(collectionJobs).innerJoin(centres, and(eq(centres.id, collectionJobs.centreId), eq(centres.organizationId, collectionJobs.organizationId))).innerJoin(appointments, and(eq(appointments.id, collectionJobs.appointmentId), eq(appointments.organizationId, collectionJobs.organizationId), eq(appointments.centreId, collectionJobs.centreId))).innerJoin(patients, and(eq(patients.id, collectionJobs.patientId), eq(patients.organizationId, collectionJobs.organizationId), eq(patients.centreId, collectionJobs.centreId))).innerJoin(patientContactSecrets, and(eq(patientContactSecrets.patientId, patients.id), eq(patientContactSecrets.organizationId, patients.organizationId), eq(patientContactSecrets.centreId, patients.centreId))).where(and(...clauses)).groupBy(collectionJobs.status);
  const rows = await getDb().select({ id: collectionJobs.id, jobNumber: collectionJobs.jobNumber, centreId: collectionJobs.centreId, centreTimeZone: centres.timeZone, appointmentId: collectionJobs.appointmentId, orderId: collectionJobs.orderId, patientId: collectionJobs.patientId, encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,visitType: appointments.visitType, status: collectionJobs.status, assignedStaffId: collectionJobs.assignedStaffId, scheduledStart: collectionJobs.scheduledStart, scheduledEnd: collectionJobs.scheduledEnd, versionNumber: collectionJobs.versionNumber, createdAt: collectionJobs.createdAt }).from(collectionJobs).innerJoin(centres, and(eq(centres.id, collectionJobs.centreId), eq(centres.organizationId, collectionJobs.organizationId))).innerJoin(appointments, and(eq(appointments.id, collectionJobs.appointmentId), eq(appointments.organizationId, collectionJobs.organizationId), eq(appointments.centreId, collectionJobs.centreId))).innerJoin(patients, and(eq(patients.id, collectionJobs.patientId), eq(patients.organizationId, collectionJobs.organizationId), eq(patients.centreId, collectionJobs.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(...clauses)).orderBy(asc(collectionJobs.scheduledStart), asc(collectionJobs.id)).limit(pageSize + 1).offset((page - 1) * pageSize);
  const hasMore = rows.length > pageSize;
  const jobs=rows.slice(0, pageSize).map(({encryptionKeyId,nameCiphertext,patientId,centreId,...row})=>{const name=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:staff.organizationId,centreId,patientId});return {...row,patientId,centreId,patientName:name.firstName,patientLastName:name.lastName};});
  const summary = Object.fromEntries(summaryRows.map((row) => [row.status, row.count]));
  return Response.json({ jobs, page, pageSize, hasMore, summary: { total: summaryRows.reduce((total, row) => total + row.count, 0), byStatus: summary } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const key = request.headers.get("idempotency-key");
  if (!key || !zUuid(key)) return Response.json({ error: "valid_idempotency_key_required" }, { status: 400 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = collectionJobCreateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_collection_job", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("collections.assign"); if (access.response) return access.response;
  const db = getDb();
  const [appointment] = await db.select({id:appointments.id,organizationId:appointments.organizationId,centreId:appointments.centreId,patientId:appointments.patientId,status:appointments.status,assignedStaffId:appointments.assignedStaffId,scheduledAt:appointments.scheduledAt,durationMinutes:appointments.durationMinutes,visitType:appointments.visitType}).from(appointments).where(and(eq(appointments.id, parsed.data.appointmentId), eq(appointments.organizationId, access.staff.organizationId))).limit(1);
  if (!appointment) return Response.json({ error: "appointment_not_found" }, { status: 404 });
  const scoped = await getApiAccess("collections.assign", appointment.centreId); if (scoped.response) return scoped.response;
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${appointment.organizationId}:collection-order:${parsed.data.orderId}`}, 0))`);
      const [order] = await tx.select().from(diagnosticOrders).where(and(eq(diagnosticOrders.id, parsed.data.orderId), eq(diagnosticOrders.organizationId, appointment.organizationId), eq(diagnosticOrders.centreId, appointment.centreId))).for("update").limit(1);
      if (!order || order.patientId !== appointment.patientId || order.appointmentId !== appointment.id) throw new Error("appointment_order_mismatch");
      if (order.status !== "CONFIRMED") throw new Error("order_not_confirmed");
      if (!["CONFIRMED", "ASSIGNED"].includes(appointment.status)) throw new Error("appointment_not_eligible");
      const [existing] = await tx.select({ id: collectionJobs.id, jobNumber: collectionJobs.jobNumber }).from(collectionJobs).where(and(eq(collectionJobs.organizationId, appointment.organizationId), eq(collectionJobs.orderId, order.id))).limit(1);
      if (existing) return { id: existing.id, jobNumber: existing.jobNumber, replayed: true };
      const id = randomUUID(); const status = appointment.assignedStaffId ? "ASSIGNED" : "PENDING_ASSIGNMENT";
      const [job] = await tx.insert(collectionJobs).values({ id, organizationId: appointment.organizationId, centreId: appointment.centreId, jobNumber: `RHC-C-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`, appointmentId: appointment.id, orderId: order.id, patientId: appointment.patientId, status, assignedStaffId: appointment.assignedStaffId, scheduledStart: appointment.scheduledAt, scheduledEnd: new Date(appointment.scheduledAt.getTime() + appointment.durationMinutes * 60_000), idempotencyKey: key, createdByStaffId: access.staff.staffUserId }).returning({ id: collectionJobs.id, jobNumber: collectionJobs.jobNumber });
      {const eventId=randomUUID();const reason="Collection job linked to confirmed appointment and diagnostic order";await tx.insert(collectionJobEvents).values({ id:eventId,organizationId: appointment.organizationId, centreId: appointment.centreId, jobId: id, eventType: "CREATED", source: "STAFF",privateDataCiphertext:encryptOperationalData({reason,evidenceReference:null},operationalContext({organizationId:appointment.organizationId,centreId:appointment.centreId,recordId:eventId},"collection-job-event")), actorStaffId: access.staff.staffUserId });}
      if (appointment.assignedStaffId) {const eventId=randomUUID();const reason="Existing appointment staff assignment carried into collection job";await tx.insert(collectionJobEvents).values({ id:eventId,organizationId: appointment.organizationId, centreId: appointment.centreId, jobId: id, eventType: "ASSIGNED", source: "STAFF",privateDataCiphertext:encryptOperationalData({reason,evidenceReference:null},operationalContext({organizationId:appointment.organizationId,centreId:appointment.centreId,recordId:eventId},"collection-job-event")), staffId: appointment.assignedStaffId, actorStaffId: access.staff.staffUserId });}
      await appendAuditEvent(tx, { organizationId: appointment.organizationId, centreId: appointment.centreId, actorStaffId: access.staff.staffUserId, action: "collection_job.created", entityType: "collection_job", entityId: id, details: { status, visitType: appointment.visitType } });
      return { ...job, replayed: false };
    });
    return Response.json({ job: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["appointment_order_mismatch", "order_not_confirmed", "appointment_not_eligible"].includes(code)) return Response.json({ error: code }, { status: 409 });
    return Response.json({ error: "collection_job_unavailable" }, { status: 409 });
  }
}

function zUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
