import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { appointmentArrivalEvents, appointmentAssignmentHistory, appointmentServices, appointmentStatusHistory, appointments, auditEvents, centres, collectionJobs, families, familyMembers, patientContactSecrets, patients, staffUsers } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { appointmentPermission, appointmentStatuses, appointmentUpdateSchema, canTransitionAppointment, localDateTimeToUtc } from "@/server/appointment-policy";
import { getAppointmentReadAccess, mayReadAppointmentAt } from "@/server/appointment-access";
import { isAssignableStaff } from "@/server/lead-assignments";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { decryptFamilyValue } from "@/server/family-crypto";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { staffAssignmentLockKey } from "@/server/staff-roster-policy";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getAppointmentReadAccess();
  if (access.response) return access.response;
  const { staff, assignedOnly } = access;
  const db = getDb();
  const currentAssignee = alias(staffUsers, "current_assignee");
  const [appointment] = await db.select({ appointment: { id: appointments.id, organizationId: appointments.organizationId, centreId: appointments.centreId, appointmentNumber: appointments.appointmentNumber, patientId: appointments.patientId, leadId: appointments.leadId, bookingSource: appointments.bookingSource, visitType: appointments.visitType, scheduledAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes, timeZone: appointments.timeZone, status: appointments.status, assignedStaffId: appointments.assignedStaffId, homeCollectionWindow: appointments.homeCollectionWindow, communicationPermission: appointments.communicationPermission, communicationPermissionRecordedBy: appointments.communicationPermissionRecordedBy, communicationPermissionRecordedAt: appointments.communicationPermissionRecordedAt, homeChargeChoice: appointments.homeChargeChoice, homeChargeRupees: appointments.homeChargeRupees, createdByStaffId: appointments.createdByStaffId, createdAt: appointments.createdAt, updatedAt: appointments.updatedAt, privateDataCiphertext: appointments.privateDataCiphertext }, assignedStaffName: currentAssignee.displayName, patientNumber: patients.patientNumber, patientEncryptionKeyId:patientContactSecrets.encryptionKeyId,patientNameCiphertext:patientContactSecrets.nameCiphertext,centreName: centres.name })
    .from(appointments).innerJoin(patients, and(eq(patients.id, appointments.patientId), eq(patients.organizationId, appointments.organizationId), eq(patients.centreId, appointments.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).innerJoin(centres, and(eq(centres.id, appointments.centreId), eq(centres.organizationId, appointments.organizationId)))
    .leftJoin(currentAssignee, and(eq(currentAssignee.id, appointments.assignedStaffId), eq(currentAssignee.organizationId, appointments.organizationId)))
    .where(and(eq(appointments.id, id), eq(appointments.organizationId, staff.organizationId), ...(assignedOnly ? [eq(appointments.assignedStaffId, staff.staffUserId)] : []))).limit(1);
  if (!appointment || !mayReadAppointmentAt(staff, appointment.appointment.centreId, appointment.appointment.assignedStaffId, staff.staffUserId, assignedOnly)) return Response.json({ error: "not_found" }, { status: 404 });
  const assignmentStaff = alias(staffUsers, "assignment_staff");
  const previousStaff = alias(staffUsers, "previous_staff");
  const actorStaff = alias(staffUsers, "assignment_actor");
  const [services, history, assignments, arrivals] = await Promise.all([
    db.select({ id: appointmentServices.id, organizationId: appointmentServices.organizationId, centreId: appointmentServices.centreId, serviceType: appointmentServices.serviceType, privateDataCiphertext: appointmentServices.privateDataCiphertext, verificationStatus: appointmentServices.verificationStatus }).from(appointmentServices).where(and(eq(appointmentServices.appointmentId, id), eq(appointmentServices.organizationId, staff.organizationId))),
    db.select({ id: appointmentStatusHistory.id, organizationId: appointmentStatusHistory.organizationId, centreId: appointmentStatusHistory.centreId, fromStatus: appointmentStatusHistory.fromStatus, toStatus: appointmentStatusHistory.toStatus, privateDataCiphertext: appointmentStatusHistory.privateDataCiphertext, previousScheduledAt: appointmentStatusHistory.previousScheduledAt, newScheduledAt: appointmentStatusHistory.newScheduledAt, actor: staffUsers.displayName, recordedAt: appointmentStatusHistory.recordedAt }).from(appointmentStatusHistory).innerJoin(staffUsers, and(eq(staffUsers.id, appointmentStatusHistory.actorStaffId), eq(staffUsers.organizationId, appointmentStatusHistory.organizationId))).where(and(eq(appointmentStatusHistory.appointmentId, id), eq(appointmentStatusHistory.organizationId, staff.organizationId))).orderBy(appointmentStatusHistory.recordedAt),
    db.select({ id: appointmentAssignmentHistory.id, organizationId: appointmentAssignmentHistory.organizationId, centreId: appointmentAssignmentHistory.centreId, action: appointmentAssignmentHistory.action, staffId: appointmentAssignmentHistory.staffId, staffName: assignmentStaff.displayName, previousStaffId: appointmentAssignmentHistory.previousStaffId, previousStaffName: previousStaff.displayName, workStart: appointmentAssignmentHistory.workStart, workEnd: appointmentAssignmentHistory.workEnd, privateDataCiphertext: appointmentAssignmentHistory.privateDataCiphertext, actor: actorStaff.displayName, recordedAt: appointmentAssignmentHistory.recordedAt }).from(appointmentAssignmentHistory).leftJoin(assignmentStaff, and(eq(assignmentStaff.id, appointmentAssignmentHistory.staffId), eq(assignmentStaff.organizationId, appointmentAssignmentHistory.organizationId))).leftJoin(previousStaff, and(eq(previousStaff.id, appointmentAssignmentHistory.previousStaffId), eq(previousStaff.organizationId, appointmentAssignmentHistory.organizationId))).innerJoin(actorStaff, and(eq(actorStaff.id, appointmentAssignmentHistory.actorStaffId), eq(actorStaff.organizationId, appointmentAssignmentHistory.organizationId))).where(and(eq(appointmentAssignmentHistory.appointmentId, id), eq(appointmentAssignmentHistory.organizationId, staff.organizationId))).orderBy(appointmentAssignmentHistory.recordedAt),
    db.select({ id: appointmentArrivalEvents.id, arrivedAt: appointmentArrivalEvents.arrivedAt, actorName: staffUsers.displayName }).from(appointmentArrivalEvents).innerJoin(staffUsers, and(eq(staffUsers.id, appointmentArrivalEvents.actorStaffId), eq(staffUsers.organizationId, appointmentArrivalEvents.organizationId))).where(and(eq(appointmentArrivalEvents.appointmentId, id), eq(appointmentArrivalEvents.organizationId, staff.organizationId))).limit(1),
  ]);
  const arrival = arrivals[0] ?? null;
  let family = null;
  if (appointmentPermission(staff.grants, "families.read", appointment.appointment.centreId)) {
    const [linkedFamily] = await db.select({ id: families.id, familyNumber: families.familyNumber, displayNameCiphertext: families.displayNameCiphertext, centreId:families.centreId }).from(familyMembers).innerJoin(families, and(eq(families.id, familyMembers.familyId), eq(families.organizationId, familyMembers.organizationId), eq(families.centreId, familyMembers.centreId))).where(and(eq(familyMembers.patientId, appointment.appointment.patientId), eq(familyMembers.organizationId, staff.organizationId), eq(familyMembers.centreId, appointment.appointment.centreId), eq(familyMembers.status, "ACTIVE"))).limit(1);
    family = linkedFamily ? {...linkedFamily,displayName:decryptFamilyValue("display-name",linkedFamily.displayNameCiphertext,{organizationId:staff.organizationId,centreId:linkedFamily.centreId,recordId:linkedFamily.id})} : null;
  }
  const patientName=decryptPatientIdentity({encryptionKeyId:appointment.patientEncryptionKeyId,nameCiphertext:appointment.patientNameCiphertext},{organizationId:staff.organizationId,centreId:appointment.appointment.centreId,patientId:appointment.appointment.patientId});
  const privateAppointment = decryptOperationalData<{homeCollectionAddress:Record<string,string>|null;collectionInstructions:string|null;communicationEvidenceReference:string|null;homeChargeReason:string|null}>(appointment.appointment.privateDataCiphertext, operationalContext({organizationId:staff.organizationId,centreId:appointment.appointment.centreId,recordId:id}, "appointment"));
  const privateServices = services.map(({privateDataCiphertext:_cipher,organizationId:_org,centreId:_centre,...s}) => ({...s,...decryptOperationalData<{serviceName:string;serviceReference:string|null}>(_cipher, operationalContext({organizationId:_org,centreId:_centre,recordId:s.id}, "appointment-service"))}));
  const privateHistory = history.map(({privateDataCiphertext:_cipher,organizationId:_org,centreId:_centre,...h}) => ({...h,...decryptOperationalData<{reason:string}>(_cipher, operationalContext({organizationId:_org,centreId:_centre,recordId:h.id}, "appointment-status-history"))}));
  const privateAssignments = assignments.map(({privateDataCiphertext:_cipher,organizationId:_org,centreId:_centre,...a}) => ({...a,...decryptOperationalData<{reason:string}>(_cipher, operationalContext({organizationId:_org,centreId:_centre,recordId:a.id}, "appointment-assignment-history"))}));
  const {privateDataCiphertext:appointmentCiphertext,...appointmentRow}=appointment.appointment; void appointmentCiphertext;
  return Response.json({ appointment: { ...appointmentRow, assignedStaffName: appointment.assignedStaffName, ...privateAppointment, patient: { id: appointment.appointment.patientId, patientNumber: appointment.patientNumber, firstName: patientName.firstName, lastName: patientName.lastName }, centreName: appointment.centreName }, services: privateServices, history: privateHistory, assignments: privateAssignments, arrival, family, capabilities: { update: appointmentPermission(staff.grants, "appointments.update", appointment.appointment.centreId), assign: appointmentPermission(staff.grants, "appointments.assign", appointment.appointment.centreId), cancel: appointmentPermission(staff.grants, "appointments.cancel", appointment.appointment.centreId), chargeOverride: appointmentPermission(staff.grants, "appointments.home_charge.manage", appointment.appointment.centreId), checkIn: appointmentPermission(staff.grants, "appointments.update", appointment.appointment.centreId) } });
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = appointmentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const base = await getApiAccess("workspace.read");
  if (base.response) return base.response;
  const db = getDb();
  const [initial] = await db.select({id:appointments.id,organizationId:appointments.organizationId,centreId:appointments.centreId,status:appointments.status,scheduledAt:appointments.scheduledAt,durationMinutes:appointments.durationMinutes,assignedStaffId:appointments.assignedStaffId,homeCollectionWindow:appointments.homeCollectionWindow,updatedAt:appointments.updatedAt}).from(appointments).where(and(eq(appointments.id, id), eq(appointments.organizationId, base.staff.organizationId))).limit(1);
  if (!initial) return Response.json({ error: "not_found" }, { status: 404 });
  const update = parsed.data;
  const rawIdempotencyKey = request.headers.get("idempotency-key");
  if (rawIdempotencyKey && !z.uuid().safeParse(rawIdempotencyKey).success) return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
  const mutationIdempotencyKey = rawIdempotencyKey ? `appointment:update:${id}:${rawIdempotencyKey}` : null;
  const mutationFingerprintContext = rawIdempotencyKey ? operationalContext({ organizationId: initial.organizationId, centreId: initial.centreId, recordId: `${id}:${rawIdempotencyKey}` }, "appointment-update-idempotency") : null;
  const mutationRequestHash = rawIdempotencyKey && mutationFingerprintContext ? fingerprintOperationalRequest(update, mutationFingerprintContext) : null;
  const legacyMutationRequestHash = rawIdempotencyKey ? createHash("sha256").update(JSON.stringify(update)).digest("hex") : null;
  const needsUpdate = Object.keys(update).some((key) => key !== "status" || update.status !== "CANCELLED");
  if (update.status === "CANCELLED") {
    const cancelAccess = await getApiAccess("appointments.cancel", initial.centreId);
    if (cancelAccess.response) return cancelAccess.response;
    if (needsUpdate) {
      const updateAccess = await getApiAccess("appointments.update", initial.centreId);
      if (updateAccess.response) return updateAccess.response;
    }
  } else {
    const updateAccess = await getApiAccess("appointments.update", initial.centreId);
    if (updateAccess.response) return updateAccess.response;
  }
  if (update.assignedStaffId !== undefined) {
    const assignAccess = await getApiAccess("appointments.assign", initial.centreId);
    if (assignAccess.response) return assignAccess.response;
  }
  if (update.communicationPermission !== undefined && update.communicationEvidenceReference === undefined) return Response.json({ error: "communication_evidence_required" }, { status: 400 });
  const [centre] = await db.select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, initial.centreId), eq(centres.organizationId, initial.organizationId))).limit(1);
  if (!centre) return Response.json({ error: "centre_not_found" }, { status: 404 });
  const newTime = update.scheduledLocal ? localDateTimeToUtc(update.scheduledLocal, centre.timeZone) : initial.scheduledAt;
  const newDuration = update.durationMinutes ?? initial.durationMinutes;
  if (!newTime || (update.scheduledLocal && newTime <= new Date())) return Response.json({ error: "appointment_time_must_be_valid_and_future" }, { status: 400 });
  const requestedStaff = update.assignedStaffId === undefined ? initial.assignedStaffId : update.assignedStaffId;
  const scheduleChanged = newTime.getTime() !== initial.scheduledAt.getTime() || newDuration !== initial.durationMinutes;
  if (initial.status === "CANCELLED" && (scheduleChanged || update.assignedStaffId !== undefined || (update.status && update.status !== initial.status) || update.collectionInstructions !== undefined || update.homeCollectionWindow !== undefined)) return Response.json({ error: "cancelled_appointment_locked" }, { status: 409 });
  try {
    const saved = await db.transaction(async (tx) => {
      if (mutationIdempotencyKey && mutationRequestHash) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${initial.organizationId}:${mutationIdempotencyKey}`}, 0))`);
        const [prior] = await tx.select({ entityType: auditEvents.entityType, entityId: auditEvents.entityId, actorStaffId: auditEvents.actorStaffId, details: auditEvents.details }).from(auditEvents)
          .where(and(eq(auditEvents.organizationId, initial.organizationId), sql`${auditEvents.details}->>'mutationIdempotencyKey' = ${mutationIdempotencyKey}`)).limit(1);
        if (prior) {
          const details = prior.details as Record<string, unknown>;
          if (prior.entityType !== "appointment" || prior.entityId !== id || prior.actorStaffId !== base.staff.staffUserId || typeof details.mutationRequestHash !== "string" || !((mutationFingerprintContext && verifyOperationalRequestFingerprint(update, details.mutationRequestHash, mutationFingerprintContext)) || details.mutationRequestHash === legacyMutationRequestHash)) throw new Error("idempotency_conflict");
          const [current] = await tx.select({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, status: appointments.status, scheduledAt: appointments.scheduledAt, assignedStaffId: appointments.assignedStaffId }).from(appointments).where(and(eq(appointments.id, id), eq(appointments.organizationId, base.staff.organizationId))).limit(1);
          if (!current) throw new Error("appointment_missing");
          return { row: current, replayed: true };
        }
      }
      if (update.assignedStaffId && !await isAssignableStaff(tx as typeof db, update.assignedStaffId, initial.organizationId, initial.centreId)) throw new Error("invalid_assignee");
      const [current] = await tx.select({id:appointments.id,organizationId:appointments.organizationId,centreId:appointments.centreId,status:appointments.status,scheduledAt:appointments.scheduledAt,durationMinutes:appointments.durationMinutes,assignedStaffId:appointments.assignedStaffId,updatedAt:appointments.updatedAt,privateDataCiphertext:appointments.privateDataCiphertext}).from(appointments).where(and(eq(appointments.id, id), eq(appointments.organizationId, base.staff.organizationId))).for("update").limit(1);
      if (!current) throw new Error("appointment_missing");
      if (update.expectedUpdatedAt && new Date(update.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) throw new Error("stale_appointment");
      const [arrival] = await tx.select({ id: appointmentArrivalEvents.id }).from(appointmentArrivalEvents).where(and(eq(appointmentArrivalEvents.appointmentId, current.id), eq(appointmentArrivalEvents.organizationId, current.organizationId))).limit(1);
      if (arrival && (scheduleChanged || (update.status !== undefined && update.status !== current.status))) throw new Error("appointment_already_checked_in");
      const changedAssignee = update.assignedStaffId !== undefined && update.assignedStaffId !== current.assignedStaffId;
      const targetStatus = update.status ?? (scheduleChanged ? "RESCHEDULED" : changedAssignee ? (requestedStaff ? "ASSIGNED" : "CONFIRMED") : current.status);
      if (targetStatus !== current.status && !canTransitionAppointment(current.status as (typeof appointmentStatuses)[number], targetStatus as (typeof appointmentStatuses)[number])) throw new Error("invalid_transition");
      if ((targetStatus === "ASSIGNED" && !requestedStaff) || (targetStatus === "CANCELLED" && changedAssignee)) throw new Error("invalid_assignment_state");
      if (requestedStaff && (scheduleChanged || changedAssignee)) {
        // Share the same per-staff transaction lock as collection assignment so
        // appointment and collection updates cannot race past each other's checks.
        const key = staffAssignmentLockKey(current.organizationId, requestedStaff);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
        const endAt = new Date(newTime.getTime() + newDuration * 60_000);
        const [conflict] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.organizationId, current.organizationId), eq(appointments.assignedStaffId, requestedStaff), notInArray(appointments.status, ["CANCELLED", "NO_SHOW"]), ne(appointments.id, current.id), lt(appointments.scheduledAt, endAt), gt(sql`${appointments.scheduledAt} + (${appointments.durationMinutes} * interval '1 minute')`, newTime))).limit(1);
        if (conflict) throw new Error("staff_time_conflict");
        const [collectionConflict] = await tx.select({ id: collectionJobs.id }).from(collectionJobs).where(and(eq(collectionJobs.organizationId, current.organizationId), eq(collectionJobs.assignedStaffId, requestedStaff), inArray(collectionJobs.status, ["PENDING_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS"]), lt(collectionJobs.scheduledStart, endAt), gt(collectionJobs.scheduledEnd, newTime))).limit(1);
        if (collectionConflict) throw new Error("staff_time_conflict");
      }
      const now = new Date();
      const privateData = decryptOperationalData<{homeCollectionAddress:Record<string,string>|null;collectionInstructions:string|null;communicationEvidenceReference:string|null;homeChargeReason:string|null}>(current.privateDataCiphertext, operationalContext({organizationId:current.organizationId,centreId:current.centreId,recordId:current.id}, "appointment"));
      const nextPrivateData = { ...privateData, ...(update.collectionInstructions !== undefined ? {collectionInstructions:update.collectionInstructions} : {}), ...(update.communicationPermission !== undefined ? {communicationEvidenceReference:update.communicationEvidenceReference??null} : {}) };
      const [row] = await tx.update(appointments).set({
        privateDataCiphertext: encryptOperationalData(nextPrivateData, operationalContext({organizationId:current.organizationId,centreId:current.centreId,recordId:current.id}, "appointment")),
        ...(scheduleChanged ? { scheduledAt: newTime, durationMinutes: newDuration } : {}), ...(update.status !== undefined || changedAssignee ? { status: targetStatus } : {}),
        ...(changedAssignee ? { assignedStaffId: requestedStaff } : {}),
        ...(update.homeCollectionWindow !== undefined ? { homeCollectionWindow: update.homeCollectionWindow } : {}),
        ...(update.communicationPermission !== undefined ? { communicationPermission: update.communicationPermission, communicationPermissionRecordedBy: base.staff.staffUserId, communicationPermissionRecordedAt: now } : {}), updatedAt: now,
      }).where(eq(appointments.id, current.id)).returning({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, status: appointments.status, scheduledAt: appointments.scheduledAt, assignedStaffId: appointments.assignedStaffId });
      if (targetStatus !== current.status || scheduleChanged) {const historyId=randomUUID();const reason=update.reason ?? (changedAssignee ? "Appointment staff assignment updated" : "Appointment booking details updated");await tx.insert(appointmentStatusHistory).values({ id:historyId, organizationId: current.organizationId, centreId: current.centreId, appointmentId: current.id, fromStatus: current.status, toStatus: targetStatus,privateDataCiphertext:encryptOperationalData({reason},operationalContext({organizationId:current.organizationId,centreId:current.centreId,recordId:historyId},"appointment-status-history")), previousScheduledAt: scheduleChanged ? current.scheduledAt : null, newScheduledAt: newTime, actorStaffId: base.staff.staffUserId });}
      if (changedAssignee) {const historyId=randomUUID();const reason=update.reason!;await tx.insert(appointmentAssignmentHistory).values({ id:historyId, organizationId: current.organizationId, centreId: current.centreId, appointmentId: current.id, action: requestedStaff ? current.assignedStaffId ? "REASSIGNED" : "ASSIGNED" : "UNASSIGNED", staffId: requestedStaff, previousStaffId: current.assignedStaffId, workStart: newTime, workEnd: new Date(newTime.getTime() + newDuration * 60_000),privateDataCiphertext:encryptOperationalData({reason},operationalContext({organizationId:current.organizationId,centreId:current.centreId,recordId:historyId},"appointment-assignment-history")), actorStaffId: base.staff.staffUserId });}
      await appendAuditEvent(tx, { organizationId: current.organizationId, centreId: current.centreId, actorStaffId: base.staff.staffUserId, action: targetStatus === "CANCELLED" ? "appointment.cancelled" : scheduleChanged ? "appointment.rescheduled" : changedAssignee ? "appointment.assigned" : update.communicationPermission !== undefined ? "appointment.communication_permission_changed" : "appointment.updated", entityType: "appointment", entityId: current.id, details: { status: row.status, scheduleChanged, assignmentChanged: changedAssignee, communicationPermissionChanged: update.communicationPermission !== undefined, ...(mutationIdempotencyKey && mutationRequestHash ? { mutationIdempotencyKey, mutationRequestHash } : {}) } });
      return { row, replayed: false };
    });
    return Response.json({ appointment: saved.row, replayed: saved.replayed });
  } catch (error) {
    if (error instanceof Error && error.message === "staff_time_conflict") return Response.json({ error: "staff_time_conflict" }, { status: 409 });
    if (error instanceof Error && error.message === "invalid_transition") return Response.json({ error: "invalid_status_transition" }, { status: 409 });
    if (error instanceof Error && error.message === "invalid_assignment_state") return Response.json({ error: "invalid_assignment_state" }, { status: 409 });
    if (error instanceof Error && error.message === "stale_appointment") return Response.json({ error: "appointment_changed_refresh_required" }, { status: 409 });
    if (error instanceof Error && error.message === "idempotency_conflict") return Response.json({ error: "idempotency_conflict" }, { status: 409 });
    if (error instanceof Error && error.message === "appointment_already_checked_in") return Response.json({ error: "appointment_already_checked_in" }, { status: 409 });
    return Response.json({ error: "appointment_update_conflict_or_unavailable" }, { status: 409 });
  }
}
