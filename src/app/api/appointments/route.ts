import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { appointmentAssignmentHistory, appointmentServices, appointmentStatusHistory, appointments, centres, collectionJobs, leadConversions, patientContactSecrets, patients, staffUsers } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { appointmentCreateSchema, homeCharge, localDateTimeToUtc } from "@/server/appointment-policy";
import { isAssignableStaff } from "@/server/lead-assignments";
import { getAppointmentReadAccess } from "@/server/appointment-access";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { staffAssignmentLockKey } from "@/server/staff-roster-policy";

const listSchema = z.object({ centreId: z.uuid().optional(), status: z.enum(["REQUESTED", "CONFIRMED", "ASSIGNED", "RESCHEDULED", "CANCELLED", "NO_SHOW"]).optional(), visitType: z.enum(["CENTRE", "HOME_COLLECTION"]).optional(), start: z.iso.datetime({ offset: true }).optional(), end: z.iso.datetime({ offset: true }).optional(), assignedStaffId: z.uuid().optional() });

export async function GET(request: Request) {
  const parsed = listSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success || (parsed.data.start && parsed.data.end && parsed.data.end <= parsed.data.start)) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const access = await getAppointmentReadAccess(parsed.data.centreId);
  if (access.response) return access.response;
  const { staff, assignedOnly } = access;
  const conditions = [eq(appointments.organizationId, staff.organizationId)];
  if (parsed.data.centreId) conditions.push(eq(appointments.centreId, parsed.data.centreId));
  if (assignedOnly) {
    if (parsed.data.assignedStaffId && parsed.data.assignedStaffId !== staff.staffUserId) return Response.json({ error: "forbidden" }, { status: 403 });
    conditions.push(eq(appointments.assignedStaffId, staff.staffUserId));
  } else if (parsed.data.assignedStaffId) conditions.push(eq(appointments.assignedStaffId, parsed.data.assignedStaffId));
  if (parsed.data.status) conditions.push(eq(appointments.status, parsed.data.status));
  if (parsed.data.visitType) conditions.push(eq(appointments.visitType, parsed.data.visitType));
  if (parsed.data.start) conditions.push(gte(appointments.scheduledAt, new Date(parsed.data.start)));
  if (parsed.data.end) conditions.push(lt(appointments.scheduledAt, new Date(parsed.data.end)));
  const assigned = alias(staffUsers, "assigned");
  const rows = await getDb().select({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, patientId: patients.id, patientNumber: patients.patientNumber, encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,centreId: centres.id, centreName: centres.name, visitType: appointments.visitType, scheduledAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes, timeZone: appointments.timeZone, status: appointments.status, assignedStaffId: appointments.assignedStaffId, staffName: assigned.displayName, homeChargeChoice: appointments.homeChargeChoice, homeChargeRupees: appointments.homeChargeRupees })
    .from(appointments).innerJoin(patients, and(eq(patients.id, appointments.patientId), eq(patients.organizationId, appointments.organizationId), eq(patients.centreId, appointments.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).innerJoin(centres, and(eq(centres.id, appointments.centreId), eq(centres.organizationId, appointments.organizationId))).leftJoin(assigned, and(eq(assigned.id, appointments.assignedStaffId), eq(assigned.organizationId, appointments.organizationId))).where(and(...conditions)).orderBy(appointments.scheduledAt).limit(200);
  const appointmentsWithNames=rows.map(({encryptionKeyId,nameCiphertext,...row})=>{const name=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:staff.organizationId,centreId:row.centreId,patientId:row.patientId});return {...row,patientName:`${name.firstName} ${name.lastName}`};});
  return Response.json({ appointments: appointmentsWithNames, truncated: rows.length === 200 });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!z.uuid().safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = appointmentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("appointments.create", parsed.data.centreId);
  if (access.response) return access.response;
  const patientAccess = await getApiAccess("patients.read", parsed.data.centreId);
  if (patientAccess.response) return patientAccess.response;
  const { staff } = access;
  if (parsed.data.source === "CRM_LEAD" && !parsed.data.leadId) return Response.json({ error: "lead_link_required" }, { status: 400 });
  if (parsed.data.leadId) {
    const leadAccess = await getApiAccess("leads.read", parsed.data.centreId);
    if (leadAccess.response) return leadAccess.response;
    const [convertedLead] = await getDb().select({ id: leadConversions.id }).from(leadConversions).where(and(eq(leadConversions.leadId, parsed.data.leadId), eq(leadConversions.patientId, parsed.data.patientId), eq(leadConversions.organizationId, staff.organizationId), eq(leadConversions.centreId, parsed.data.centreId))).limit(1);
    if (!convertedLead) return Response.json({ error: "lead_patient_link_not_verified" }, { status: 409 });
  }
  if (parsed.data.assignedStaffId) {
    const assignAccess = await getApiAccess("appointments.assign", parsed.data.centreId);
    if (assignAccess.response) return assignAccess.response;
    if (!await isAssignableStaff(getDb(), parsed.data.assignedStaffId, staff.organizationId, parsed.data.centreId)) return Response.json({ error: "invalid_assignee" }, { status: 400 });
  }
  const home = parsed.data.homeCollection;
  if (home?.chargeChoice === "CUSTOM" || home?.chargeChoice === "WAIVED") {
    const chargeAccess = await getApiAccess("appointments.home_charge.manage", parsed.data.centreId);
    if (chargeAccess.response) return chargeAccess.response;
  }
  const db = getDb();
  const [centre] = await db.select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, parsed.data.centreId), eq(centres.organizationId, staff.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
  if (!centre) return Response.json({ error: "centre_not_found" }, { status: 404 });
  const scheduledAt = localDateTimeToUtc(parsed.data.scheduledLocal, centre.timeZone);
  if (!scheduledAt || scheduledAt <= new Date()) return Response.json({ error: "appointment_time_must_be_valid_and_future" }, { status: 400 });
  const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, parsed.data.patientId), eq(patients.organizationId, staff.organizationId), eq(patients.centreId, parsed.data.centreId))).limit(1);
  if (!patient) return Response.json({ error: "patient_not_found_in_centre" }, { status: 404 });
  const fingerprintContext = operationalContext({ organizationId: staff.organizationId, centreId: parsed.data.centreId, recordId: idempotencyKey! }, "appointment-create-idempotency");
  const requestHash = fingerprintOperationalRequest(parsed.data, fingerprintContext);
  const legacyRequestHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  let transactionStage = "begin";
  try {
    const result = await db.transaction(async (tx) => {
      transactionStage = "idempotency_lock";
      const idempotencyLock = `${staff.organizationId}:appointment-key:${idempotencyKey}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLock}, 0))`);
      transactionStage = "idempotency_lookup";
      const [existing] = await tx.select({
        id: appointments.id, appointmentNumber: appointments.appointmentNumber, status: appointments.status,
        requestHash: appointments.requestHash, centreId: appointments.centreId, patientId: appointments.patientId,
        leadId: appointments.leadId, bookingSource: appointments.bookingSource, visitType: appointments.visitType,
        scheduledAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes,
        assignedStaffId: appointments.assignedStaffId, homeCollectionWindow: appointments.homeCollectionWindow,
        homeChargeChoice: appointments.homeChargeChoice, homeChargeRupees: appointments.homeChargeRupees,
        privateDataCiphertext: appointments.privateDataCiphertext,
      }).from(appointments).where(and(eq(appointments.organizationId, staff.organizationId), eq(appointments.idempotencyKey, idempotencyKey!))).limit(1);
      if (existing) {
        // Older rows used a full-payload hash. Preserve exact legacy retries;
        // new rows compare private fields only after decrypting their stored
        // authenticated ciphertext in the owning record context.
        const samePayload = verifyOperationalRequestFingerprint(parsed.data, existing.requestHash, fingerprintContext) || existing.requestHash === legacyRequestHash;
        if (!samePayload) throw new Error("idempotency_conflict");
        return { appointment: { id: existing.id, appointmentNumber: existing.appointmentNumber, status: existing.status }, replayed: true };
      }
      const endAt = new Date(scheduledAt.getTime() + parsed.data.durationMinutes * 60_000);
      if (parsed.data.assignedStaffId) {
        const staffLock = staffAssignmentLockKey(staff.organizationId, parsed.data.assignedStaffId);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${staffLock}, 0))`);
        const [conflict] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.organizationId, staff.organizationId), eq(appointments.assignedStaffId, parsed.data.assignedStaffId), notInArray(appointments.status, ["CANCELLED", "NO_SHOW"]), lt(appointments.scheduledAt, endAt), gt(sql`${appointments.scheduledAt} + (${appointments.durationMinutes} * interval '1 minute')`, scheduledAt))).limit(1);
        if (conflict) throw new Error("staff_time_conflict");
        const [collectionConflict] = await tx.select({ id: collectionJobs.id }).from(collectionJobs).where(and(eq(collectionJobs.organizationId, staff.organizationId), eq(collectionJobs.assignedStaffId, parsed.data.assignedStaffId), inArray(collectionJobs.status, ["PENDING_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS"]), lt(collectionJobs.scheduledStart, endAt), gt(collectionJobs.scheduledEnd, scheduledAt))).limit(1);
        if (collectionConflict) throw new Error("staff_time_conflict");
      }
      const status = parsed.data.assignedStaffId ? "ASSIGNED" : "REQUESTED";
      const id = randomUUID();
      transactionStage = "appointment_insert";
      const privateDataCiphertext = encryptOperationalData({ homeCollectionAddress: home?.address ?? null, collectionInstructions: home?.instructions ?? null, communicationEvidenceReference: null, homeChargeReason: home?.chargeReason ?? null }, operationalContext({ organizationId: staff.organizationId, centreId: parsed.data.centreId, recordId: id }, "appointment"));
      const [created] = await tx.insert(appointments).values({
        id, organizationId: staff.organizationId, centreId: parsed.data.centreId, appointmentNumber: `RHC-A-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`,
        patientId: parsed.data.patientId, leadId: parsed.data.leadId ?? null, bookingSource: parsed.data.source, visitType: parsed.data.visitType, scheduledAt, durationMinutes: parsed.data.durationMinutes,
        timeZone: centre.timeZone, status, assignedStaffId: parsed.data.assignedStaffId ?? null,
        privateDataCiphertext, homeCollectionWindow: home?.preferredWindow ?? null,
        homeChargeChoice: home?.chargeChoice ?? null, homeChargeRupees: home ? homeCharge(home.chargeChoice, home.customAmountRupees) : null,
        createdByStaffId: staff.staffUserId, idempotencyKey: idempotencyKey!, requestHash,
      }).returning({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, status: appointments.status });
      transactionStage = "appointment_service_insert";
      await tx.insert(appointmentServices).values(parsed.data.services.map((service) => { const serviceId = randomUUID(); return { id: serviceId, organizationId: staff.organizationId, centreId: parsed.data.centreId, appointmentId: id, serviceType: service.type, privateDataCiphertext: encryptOperationalData({ serviceName: service.name, serviceReference: service.reference ?? null }, operationalContext({ organizationId: staff.organizationId, centreId: parsed.data.centreId, recordId: serviceId }, "appointment-service")), verificationStatus: "PENDING" }; }));
      transactionStage = "appointment_history_insert";
      { const historyId = randomUUID(); const reason = "Booking request recorded; confirmation pending staff review"; await tx.insert(appointmentStatusHistory).values({ id: historyId, organizationId: staff.organizationId, centreId: parsed.data.centreId, appointmentId: id, fromStatus: null, toStatus: status,privateDataCiphertext: encryptOperationalData({ reason }, operationalContext({ organizationId: staff.organizationId, centreId: parsed.data.centreId, recordId: historyId }, "appointment-status-history")), newScheduledAt: scheduledAt, actorStaffId: staff.staffUserId }); }
      if (parsed.data.assignedStaffId) { const historyId = randomUUID(); const reason = "Staff assignment recorded with booking"; await tx.insert(appointmentAssignmentHistory).values({ id: historyId, organizationId: staff.organizationId, centreId: parsed.data.centreId, appointmentId: id, action: "ASSIGNED", staffId: parsed.data.assignedStaffId, workStart: scheduledAt, workEnd: endAt,privateDataCiphertext: encryptOperationalData({ reason }, operationalContext({ organizationId: staff.organizationId, centreId: parsed.data.centreId, recordId: historyId }, "appointment-assignment-history")), actorStaffId: staff.staffUserId }); }
      transactionStage = "audit_append";
      await appendAuditEvent(tx, { organizationId: staff.organizationId, centreId: parsed.data.centreId, actorStaffId: staff.staffUserId, action: "appointment.created", entityType: "appointment", entityId: id, details: { status, visitType: parsed.data.visitType, source: parsed.data.source, serviceCount: parsed.data.services.length, homeChargeChoice: home?.chargeChoice ?? null, homeChargeRupees: home ? homeCharge(home.chargeChoice, home.customAmountRupees) : null } });
      return { appointment: created, replayed: false };
    });
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "idempotency_conflict") return Response.json({ error: "idempotency_key_reused" }, { status: 409 });
    if (error instanceof Error && error.message === "staff_time_conflict") return Response.json({ error: "staff_time_conflict" }, { status: 409 });
    const diagnostic = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; constraint?: unknown; column?: unknown; table?: unknown; message?: unknown; cause?: unknown; stack?: unknown } : {};
    const causeChain: Array<{ code?: unknown; constraint?: unknown; column?: unknown; table?: unknown; message?: unknown }> = [];
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
      const item = current as { code?: unknown; constraint?: unknown; column?: unknown; table?: unknown; message?: unknown; cause?: unknown };
      causeChain.push(item);
      current = item.cause;
    }
    const findSafe = (key: "code" | "constraint" | "column" | "table", pattern: RegExp) => causeChain.map((item) => item[key]).find((value) => typeof value === "string" && pattern.test(value)) as string | undefined;
    const pgCode = findSafe("code", /^[0-9A-Z]{5}$/);
    const constraint = findSafe("constraint", /^[a-z][a-z0-9_]{0,62}$/) ?? causeChain.map((item) => typeof item.message === "string" ? item.message.match(/constraint\s+"?([a-z][a-z0-9_]{0,62})"?/i)?.[1] : undefined).find(Boolean);
    const column = findSafe("column", /^[a-z][a-z0-9_]{0,62}$/) ?? causeChain.map((item) => typeof item.message === "string" ? item.message.match(/column\s+"?([a-z][a-z0-9_]*)"?\s+(?:of relation|does not exist)/i)?.[1] : undefined).find(Boolean);
    const table = findSafe("table", /^[a-z][a-z0-9_]{0,62}$/) ?? causeChain.map((item) => typeof item.message === "string" ? item.message.match(/of relation\s+"?([a-z][a-z0-9_]*)"?/i)?.[1] : undefined).find(Boolean);
    const errorName = typeof diagnostic.name === "string" && /^[A-Za-z]{1,40}$/.test(diagnostic.name) ? diagnostic.name : "UnknownError";
    const errorCategory = causeChain.map((item) => typeof item.message === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(item.message) ? item.message : undefined).find(Boolean);
    const sourceFrame = typeof diagnostic.stack === "string" ? diagnostic.stack.split("\n").find((line) => /route\.ts:\d+:\d+/.test(line))?.trim().replace(/[^A-Za-z0-9_./:()\\ -]/g, "") : undefined;
    console.error(["appointment_create_transaction_failed", `stage=${transactionStage}`, `error=${errorName}`, `pgCode=${pgCode ?? "none"}`, `table=${table ?? "none"}`, `column=${column ?? "none"}`, `constraint=${constraint ?? "none"}`, `category=${errorCategory ?? "none"}`, `source=${sourceFrame ?? "none"}`].join(" "));
    return Response.json({ error: "appointment_creation_failed" }, { status: 500 });
  }
}
