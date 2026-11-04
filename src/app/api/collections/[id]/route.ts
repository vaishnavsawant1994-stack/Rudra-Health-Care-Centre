import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getCollectionReadAccess } from "@/server/collection-access";
import { getDb } from "@/db/client";
import { appointments, auditEvents, collectionJobEvents, collectionJobs, permissions, rolePermissions, roles, staffRoleAssignments, staffUsers, specimens as specimensTable } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { collectionJobActionSchema, isAssignedCollector } from "@/server/sample-policy";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { staffAssignmentLockKey } from "@/server/staff-roster-policy";
import { createHash, randomUUID } from "node:crypto";

const idSchema = z.uuid();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const base = await getCollectionReadAccess(); if (base.response) return base.response;
  const db = getDb(); const [job] = await db.select({ id: collectionJobs.id, organizationId: collectionJobs.organizationId, centreId: collectionJobs.centreId, jobNumber: collectionJobs.jobNumber, appointmentId: collectionJobs.appointmentId, orderId: collectionJobs.orderId, patientId: collectionJobs.patientId, status: collectionJobs.status, assignedStaffId: collectionJobs.assignedStaffId, scheduledStart: collectionJobs.scheduledStart, scheduledEnd: collectionJobs.scheduledEnd, versionNumber: collectionJobs.versionNumber, visitType: appointments.visitType, appointmentCiphertext:appointments.privateDataCiphertext, homeCollectionWindow: appointments.homeCollectionWindow }).from(collectionJobs).innerJoin(appointments, and(eq(appointments.id, collectionJobs.appointmentId), eq(appointments.organizationId, collectionJobs.organizationId), eq(appointments.centreId, collectionJobs.centreId))).where(and(eq(collectionJobs.id, id), eq(collectionJobs.organizationId, base.staff.organizationId))).limit(1);
  if (!job) return Response.json({ error: "not_found" }, { status: 404 });
  const scoped = await getCollectionReadAccess(job.centreId); if (scoped.response) return scoped.response;
  if (job.assignedStaffId !== scoped.staff.staffUserId && !scoped.staff.grants.some((g) => g.key === "collections.assign" && (g.centreId === null || g.centreId === job.centreId))) return Response.json({ error: "not_found" }, { status: 404 });
  const [events, specimens] = await Promise.all([
    db.select({id:collectionJobEvents.id,organizationId:collectionJobEvents.organizationId,centreId:collectionJobEvents.centreId,eventType: collectionJobEvents.eventType, source: collectionJobEvents.source, privateDataCiphertext:collectionJobEvents.privateDataCiphertext, recordedAt: collectionJobEvents.recordedAt }).from(collectionJobEvents).where(and(eq(collectionJobEvents.jobId, id), eq(collectionJobEvents.organizationId, scoped.staff.organizationId))).orderBy(asc(collectionJobEvents.recordedAt)),
    db.select({ id: specimensTable.id,organizationId:specimensTable.organizationId,centreId:specimensTable.centreId,privateDataCiphertext:specimensTable.privateDataCiphertext, specimenNumber: specimensTable.specimenNumber, status: specimensTable.status, collectedAt: specimensTable.collectedAt, receivedAt: specimensTable.receivedAt, versionNumber: specimensTable.versionNumber }).from(specimensTable).where(and(eq(specimensTable.jobId, id), eq(specimensTable.organizationId, scoped.staff.organizationId))).orderBy(asc(specimensTable.collectedAt)),
  ]);
  const {appointmentCiphertext,...jobBase}=job;const appointmentPrivate=decryptOperationalData<{homeCollectionAddress:Record<string,string>|null}>(appointmentCiphertext,operationalContext({organizationId:job.organizationId,centreId:job.centreId,recordId:job.appointmentId},"appointment"));
  const safeEvents=events.map(({privateDataCiphertext,...event})=>({...event,...decryptOperationalData<{reason:string;evidenceReference:string|null;estimatedArrivalAt?:string}>(privateDataCiphertext,operationalContext({organizationId:event.organizationId,centreId:event.centreId,recordId:event.id},"collection-job-event"))}));
  const safeSpecimens=specimens.map(({privateDataCiphertext,...sample})=>({...sample,...decryptOperationalData<{specimenType:string;requirementReference:string}>(privateDataCiphertext,operationalContext({organizationId:sample.organizationId,centreId:sample.centreId,recordId:sample.id},"specimen"))}));
  return Response.json({ job:{...jobBase,...appointmentPrivate}, events:safeEvents, specimens:safeSpecimens });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await context.params; if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = collectionJobActionSchema.safeParse(body); if (!parsed.success) return Response.json({ error: "invalid_collection_action", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  if (parsed.data.action === "delay" && parsed.data.estimatedArrivalAt && Date.parse(parsed.data.estimatedArrivalAt) <= Date.now()) return Response.json({ error: "estimated_arrival_must_be_future" }, { status: 400 });
  const permission = parsed.data.action === "assign" || parsed.data.action === "cancel" ? "collections.assign" : parsed.data.action === "complete" ? "samples.collect" : "collections.visit.record";
  const rawIdempotencyKey = request.headers.get("idempotency-key");
  if (!idSchema.safeParse(rawIdempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const mutationIdempotencyKey = parsed.data.action === "assign" ? `collection:assign:${id}:${rawIdempotencyKey}` : `collection:${parsed.data.action}:${id}:${rawIdempotencyKey}`;
  const legacyMutationRequestHash = parsed.data.action === "assign" ? createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex") : null;
  const base = await getApiAccess(permission); if (base.response) return base.response;
  const db = getDb(); const [initial] = await db.select({ organizationId: collectionJobs.organizationId, centreId: collectionJobs.centreId, assignedStaffId: collectionJobs.assignedStaffId }).from(collectionJobs).where(and(eq(collectionJobs.id, id), eq(collectionJobs.organizationId, base.staff.organizationId))).limit(1);
  if (!initial) return Response.json({ error: "not_found" }, { status: 404 });
  const mutationFingerprintContext = operationalContext({ organizationId: initial.organizationId, centreId: initial.centreId, recordId: `${id}:${rawIdempotencyKey}` }, parsed.data.action === "assign" ? "collection-assignment-idempotency" : "collection-action-idempotency");
  const mutationRequestHash = fingerprintOperationalRequest(parsed.data, mutationFingerprintContext);
  const access = await getApiAccess(permission, initial.centreId); if (access.response) return access.response;
  if (["collections.visit.record", "samples.collect"].includes(permission) && !isAssignedCollector(access.staff.staffUserId, initial.assignedStaffId, access.staff.grants, initial.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const result = await db.transaction(async (tx) => {
      const [job] = await tx.select().from(collectionJobs).where(and(eq(collectionJobs.id, id), eq(collectionJobs.organizationId, access.staff.organizationId), eq(collectionJobs.centreId, initial.centreId))).for("update").limit(1);
      if (!job) throw new Error("not_found");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${job.organizationId}:${mutationIdempotencyKey}`}, 0))`);
      const [prior] = await tx.select({ entityType: auditEvents.entityType, entityId: auditEvents.entityId, actorStaffId: auditEvents.actorStaffId, details: auditEvents.details }).from(auditEvents)
        .where(and(eq(auditEvents.organizationId, job.organizationId), sql`${auditEvents.details}->>'mutationIdempotencyKey' = ${mutationIdempotencyKey}`)).limit(1);
      if (prior) {
        const details = prior.details as Record<string, unknown>;
        if (prior.entityType !== "collection_job" || prior.entityId !== id || prior.actorStaffId !== access.staff.staffUserId || typeof details.mutationRequestHash !== "string" || !(verifyOperationalRequestFingerprint(parsed.data, details.mutationRequestHash, mutationFingerprintContext) || (legacyMutationRequestHash !== null && details.mutationRequestHash === legacyMutationRequestHash))) throw new Error("idempotency_conflict");
        return { id: job.id, status: job.status, versionNumber: job.versionNumber, replayed: true };
      }
      if (parsed.data.action === "decline" && job.assignedStaffId !== access.staff.staffUserId) throw new Error("not_found");
      if (job.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
      if (parsed.data.action === "assign") {
        if (!["PENDING_ASSIGNMENT", "ASSIGNED", "UNSUCCESSFUL"].includes(job.status)) throw new Error("job_closed");
        const [collector] = await tx.select({ id: staffUsers.id }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt), or(isNull(staffRoleAssignments.centreId), eq(staffRoleAssignments.centreId, job.centreId)))).innerJoin(roles, and(eq(roles.id, staffRoleAssignments.roleId), eq(roles.organizationId, staffRoleAssignments.organizationId))).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "collections.visit.record"))).where(and(eq(staffUsers.id, parsed.data.staffUserId), eq(staffUsers.organizationId, job.organizationId), eq(staffUsers.status, "ACTIVE"))).limit(1);
        if (!collector) throw new Error("collector_not_authorized");
        const lock = staffAssignmentLockKey(job.organizationId, collector.id); await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
        const [conflict] = await tx.select({ id: collectionJobs.id }).from(collectionJobs).where(and(eq(collectionJobs.organizationId, job.organizationId), eq(collectionJobs.assignedStaffId, collector.id), ne(collectionJobs.id, id), inArray(collectionJobs.status, ["PENDING_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS"]), sql`${collectionJobs.scheduledStart} < ${job.scheduledEnd}`, sql`${collectionJobs.scheduledEnd} > ${job.scheduledStart}`)).limit(1);
        const [appointmentConflict] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.organizationId, job.organizationId), eq(appointments.assignedStaffId, collector.id), ne(appointments.id, job.appointmentId), sql`${appointments.status} NOT IN ('CANCELLED','NO_SHOW')`, sql`${appointments.scheduledAt} < ${job.scheduledEnd}`, sql`${appointments.scheduledAt} + (${appointments.durationMinutes} * interval '1 minute') > ${job.scheduledStart}`)).limit(1);
        if (conflict || appointmentConflict) throw new Error("staff_schedule_conflict");
        const was = job.assignedStaffId; const updated = await tx.update(collectionJobs).set({ assignedStaffId: collector.id, status: "ASSIGNED", versionNumber: job.versionNumber + 1, updatedAt: new Date() }).where(and(eq(collectionJobs.id, id), eq(collectionJobs.versionNumber, job.versionNumber))).returning({ id: collectionJobs.id, status: collectionJobs.status, versionNumber: collectionJobs.versionNumber });
        const eventId=randomUUID();await tx.insert(collectionJobEvents).values({ id:eventId,organizationId: job.organizationId, centreId: job.centreId, jobId: id, eventType: was ? "REASSIGNED" : "ASSIGNED", source: "STAFF",privateDataCiphertext:encryptOperationalData({reason:parsed.data.reason,evidenceReference:null},operationalContext({organizationId:job.organizationId,centreId:job.centreId,recordId:eventId},"collection-job-event")), staffId: collector.id, previousStaffId: was, actorStaffId: access.staff.staffUserId });
        await appendAuditEvent(tx, { organizationId: job.organizationId, centreId: job.centreId, actorStaffId: access.staff.staffUserId, action: "collection_job.assigned", entityType: "collection_job", entityId: id, details: { reassigned: Boolean(was), mutationIdempotencyKey, mutationRequestHash } }); return { ...updated[0], replayed: false };
      }
      if (parsed.data.action === "decline") {
        if (job.status !== "ASSIGNED" || job.assignedStaffId !== access.staff.staffUserId) throw new Error("invalid_transition");
        const [updated] = await tx.update(collectionJobs).set({ status: "PENDING_ASSIGNMENT", assignedStaffId: null, versionNumber: job.versionNumber + 1, updatedAt: new Date() }).where(and(eq(collectionJobs.id, id), eq(collectionJobs.versionNumber, job.versionNumber))).returning({ id: collectionJobs.id, status: collectionJobs.status, versionNumber: collectionJobs.versionNumber });
        const eventId = randomUUID();
        await tx.insert(collectionJobEvents).values({ id: eventId, organizationId: job.organizationId, centreId: job.centreId, jobId: id, eventType: "ASSIGNMENT_DECLINED", source: "STAFF", privateDataCiphertext: encryptOperationalData({ reason: parsed.data.reason, evidenceReference: null }, operationalContext({ organizationId: job.organizationId, centreId: job.centreId, recordId: eventId }, "collection-job-event")), previousStaffId: job.assignedStaffId, actorStaffId: access.staff.staffUserId });
        await appendAuditEvent(tx, { organizationId: job.organizationId, centreId: job.centreId, actorStaffId: access.staff.staffUserId, action: "collection_job.assignment_declined", entityType: "collection_job", entityId: id, details: { status: updated.status, mutationIdempotencyKey, mutationRequestHash } });
        return { ...updated, replayed: false };
      }
      let eventType: string; let nextStatus = job.status;
      if (parsed.data.action === "accept") {
        if (job.status !== "ASSIGNED" || job.assignedStaffId !== access.staff.staffUserId) throw new Error("invalid_transition");
        const [latestAssignmentEvent] = await tx.select({ eventType: collectionJobEvents.eventType }).from(collectionJobEvents).where(and(eq(collectionJobEvents.jobId, id), eq(collectionJobEvents.organizationId, job.organizationId), inArray(collectionJobEvents.eventType, ["ASSIGNED", "REASSIGNED", "ASSIGNMENT_DECLINED", "ASSIGNMENT_ACCEPTED"]))).orderBy(sql`${collectionJobEvents.recordedAt} DESC, ${collectionJobEvents.id} DESC`).limit(1);
        if (!latestAssignmentEvent || !["ASSIGNED", "REASSIGNED"].includes(latestAssignmentEvent.eventType)) throw new Error("invalid_transition");
        eventType = "ASSIGNMENT_ACCEPTED";
      }
      else if (parsed.data.action === "start") {
        if (job.status !== "ASSIGNED" || job.assignedStaffId !== access.staff.staffUserId) throw new Error("invalid_transition");
        const [latestAssignmentEvent] = await tx.select({ eventType: collectionJobEvents.eventType, actorStaffId: collectionJobEvents.actorStaffId }).from(collectionJobEvents).where(and(eq(collectionJobEvents.jobId, id), eq(collectionJobEvents.organizationId, job.organizationId), inArray(collectionJobEvents.eventType, ["ASSIGNED", "REASSIGNED", "ASSIGNMENT_DECLINED", "ASSIGNMENT_ACCEPTED"]))).orderBy(sql`${collectionJobEvents.recordedAt} DESC, ${collectionJobEvents.id} DESC`).limit(1);
        if (latestAssignmentEvent?.eventType !== "ASSIGNMENT_ACCEPTED" || latestAssignmentEvent.actorStaffId !== access.staff.staffUserId) throw new Error("assignment_acceptance_required");
        eventType = "VISIT_STARTED"; nextStatus = "IN_PROGRESS";
      }
      else if (parsed.data.action === "complete") { if (job.status !== "IN_PROGRESS") throw new Error("invalid_transition"); const [sample] = await tx.select({ id: specimensTable.id }).from(specimensTable).where(and(eq(specimensTable.jobId, id), eq(specimensTable.organizationId, job.organizationId), eq(specimensTable.centreId, job.centreId))).limit(1); if (!sample) throw new Error("specimen_record_required"); eventType = "COLLECTION_RECORDED"; nextStatus = "COLLECTED"; }
      else if (parsed.data.action === "arrive") { if (job.status !== "IN_PROGRESS") throw new Error("invalid_transition"); eventType = "ARRIVED"; }
      else if (parsed.data.action === "delay") { if (job.status !== "IN_PROGRESS") throw new Error("invalid_transition"); eventType = "VISIT_DELAYED"; }
      else if (parsed.data.action === "unsuccessful") { if (job.status !== "IN_PROGRESS") throw new Error("invalid_transition"); eventType = "ATTEMPT_FAILED"; nextStatus = "UNSUCCESSFUL"; }
      else { if (["COLLECTED", "CANCELLED"].includes(job.status)) throw new Error("job_closed"); eventType = "CANCELLED"; nextStatus = "CANCELLED"; }
      const updated = await tx.update(collectionJobs).set({ status: nextStatus, versionNumber: job.versionNumber + 1, updatedAt: new Date() }).where(and(eq(collectionJobs.id, id), eq(collectionJobs.versionNumber, job.versionNumber))).returning({ id: collectionJobs.id, status: collectionJobs.status, versionNumber: collectionJobs.versionNumber });
      const eventId=randomUUID();const evidenceReference=parsed.data.action === "arrive" ? parsed.data.evidenceReference : null;const estimatedArrivalAt=parsed.data.action === "delay" ? parsed.data.estimatedArrivalAt : undefined;await tx.insert(collectionJobEvents).values({ id:eventId,organizationId: job.organizationId, centreId: job.centreId, jobId: id, eventType, source: "STAFF",privateDataCiphertext:encryptOperationalData({reason:parsed.data.reason,evidenceReference,...(estimatedArrivalAt ? { estimatedArrivalAt } : {})},operationalContext({organizationId:job.organizationId,centreId:job.centreId,recordId:eventId},"collection-job-event")), staffId: parsed.data.action === "accept" ? access.staff.staffUserId : null, actorStaffId: access.staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: job.organizationId, centreId: job.centreId, actorStaffId: access.staff.staffUserId, action: `collection_job.${parsed.data.action}`, entityType: "collection_job", entityId: id, details: { status: nextStatus, mutationIdempotencyKey, mutationRequestHash } }); return { ...updated[0], replayed: false };
    });
    return Response.json({ job: result, replayed: result.replayed });
  } catch (error) {
    const code = error instanceof Error ? error.message : ""; const known = ["not_found", "version_conflict", "job_closed", "invalid_transition", "assignment_acceptance_required", "collector_not_authorized", "staff_schedule_conflict", "specimen_record_required", "idempotency_conflict"];
    if (known.includes(code)) return Response.json({ error: code }, { status: code === "not_found" ? 404 : code === "version_conflict" || code === "staff_schedule_conflict" || code === "idempotency_conflict" || code === "assignment_acceptance_required" ? 409 : 400 });
    return Response.json({ error: "collection_operation_unavailable" }, { status: 409 });
  }
}
