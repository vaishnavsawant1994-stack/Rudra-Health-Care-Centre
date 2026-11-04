import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { collectionJobEvents, collectionJobs, patientContactSecrets, sampleCustodyEvents, sampleExceptions, sampleProcedureApprovals, specimens, patients } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { assignedHandoverCentreScope, isAssignedCollector, matchesSpecimenCollectionReplay, sampleCollectSchema, sampleDirectoryStatusFilter, sampleDirectoryViewSchema, sampleExceptionSchema, sampleHandoverSubmitSchema, sampleReceiveSchema } from "@/server/sample-policy";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { assignmentVisibility } from "@/server/assignment-visibility";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("collect"), ...sampleCollectSchema.shape }),
  z.object({ action: z.literal("submit_for_receiving"), ...sampleHandoverSubmitSchema.shape }),
  z.object({ action: z.literal("receive"), ...sampleReceiveSchema.shape }),
  z.object({ action: z.literal("exception"), ...sampleExceptionSchema.shape }),
]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestedCentreId = params.get("centreId") ?? undefined;
  if (requestedCentreId && !z.string().uuid().safeParse(requestedCentreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const parsedView = sampleDirectoryViewSchema.safeParse(params.get("view") ?? "all");
  if (!parsedView.success) return Response.json({ error: "invalid_sample_view" }, { status: 400 });
  const exceptionId = params.get("exceptionId");
  if (exceptionId && (!z.uuid().safeParse(exceptionId).success || parsedView.data !== "exceptions")) return Response.json({ error: "invalid_exception_filter" }, { status: 400 });
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 50);
  if (!Number.isInteger(page) || page < 1 || page > 10_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return Response.json({ error: "invalid_pagination" }, { status: 400 });
  let access = await getApiAccess("samples.read", requestedCentreId);
  let assignedHandoverOnly = false;
  // Field staff may see only their own collected specimens in the handover
  // queue. This fallback is intentionally unavailable for any other view.
  if (access.response?.status === 403 && parsedView.data === "handover") {
    const fieldAccess = await getApiAccess("collections.visit.record", requestedCentreId);
    if (!fieldAccess.response) {
      access = fieldAccess;
      assignedHandoverOnly = true;
    }
  }
  if (access.response) return access.response;
  const visibility = assignmentVisibility(access.staff.grants, "samples.read", "collections.assign", ["samples.collect", "collections.visit.record"]);
  const scope = visibility.readCentres;
  const clauses = [eq(specimens.organizationId, access.staff.organizationId)];
  if (requestedCentreId) clauses.push(eq(specimens.centreId, requestedCentreId));
  const statuses = sampleDirectoryStatusFilter(parsedView.data, exceptionId);
  if (statuses) clauses.push(inArray(specimens.status, [...statuses]));
  if (exceptionId) clauses.push(sql`EXISTS (SELECT 1 FROM sample_exceptions se WHERE se.id = ${exceptionId}::uuid AND se.organization_id = ${specimens.organizationId} AND se.centre_id = ${specimens.centreId} AND se.specimen_id = ${specimens.id})`);
  const handoverSubmitted = sql<boolean>`EXISTS (SELECT 1 FROM sample_custody_events submission WHERE submission.organization_id = ${specimens.organizationId} AND submission.centre_id = ${specimens.centreId} AND submission.specimen_id = ${specimens.id} AND submission.event_type = 'SUBMITTED_FOR_RECEIVING')`;
  if (parsedView.data === "receiving") clauses.push(or(eq(specimens.receivingSubmissionRequired, false), handoverSubmitted)!);
  if (assignedHandoverOnly) {
    clauses.push(eq(collectionJobs.assignedStaffId, access.staff.staffUserId));
    const allowedCentres = assignedHandoverCentreScope(access.staff.grants);
    if (allowedCentres !== null) {
      clauses.push(allowedCentres.length ? inArray(specimens.centreId, allowedCentres) : eq(specimens.centreId, "00000000-0000-0000-0000-000000000000"));
    }
  } else {
    if (scope !== null) clauses.push(scope.length ? inArray(specimens.centreId, scope) : eq(specimens.centreId, "00000000-0000-0000-0000-000000000000"));
  }
  if (!assignedHandoverOnly && visibility.restricted) {
    const permitted = [];
    if (visibility.unrestrictedCentres?.length) permitted.push(inArray(specimens.centreId, visibility.unrestrictedCentres));
    if (visibility.assignedOnlyCentres === null) permitted.push(eq(collectionJobs.assignedStaffId, access.staff.staffUserId));
    else if (visibility.assignedOnlyCentres.length) permitted.push(and(inArray(specimens.centreId, visibility.assignedOnlyCentres), eq(collectionJobs.assignedStaffId, access.staff.staffUserId)));
    clauses.push(permitted.length ? or(...permitted)! : eq(specimens.id, "00000000-0000-0000-0000-000000000000"));
  }
  const rows = await getDb().select({ id: specimens.id, organizationId:specimens.organizationId,centreId: specimens.centreId, jobId: specimens.jobId, orderId: specimens.orderId, patientId: specimens.patientId, assignedStaffId: collectionJobs.assignedStaffId, encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,specimenNumber: specimens.specimenNumber,privateDataCiphertext:specimens.privateDataCiphertext, status: specimens.status, collectedAt: specimens.collectedAt, receivedAt: specimens.receivedAt, versionNumber: specimens.versionNumber, receivingSubmissionRequired: specimens.receivingSubmissionRequired, handoverSubmitted }).from(specimens).innerJoin(collectionJobs, and(eq(collectionJobs.id, specimens.jobId), eq(collectionJobs.organizationId, specimens.organizationId), eq(collectionJobs.centreId, specimens.centreId))).innerJoin(patients, and(eq(patients.id, specimens.patientId), eq(patients.organizationId, specimens.organizationId), eq(patients.centreId, specimens.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(...clauses)).orderBy(asc(specimens.collectedAt), asc(specimens.id)).limit(pageSize + 1).offset((page - 1) * pageSize);
  const hasMore = rows.length > pageSize;
  if (assignedHandoverOnly) {
    const specimensForHandover = rows.slice(0, pageSize).map(({ id, centreId, jobId, specimenNumber, status, collectedAt, versionNumber, receivingSubmissionRequired, handoverSubmitted }) => ({ id, centreId, jobId, specimenNumber, status, collectedAt, versionNumber, receivingSubmissionRequired, handoverSubmitted, canSubmitHandover: status === "COLLECTED" && !handoverSubmitted }));
    return Response.json({ specimens: specimensForHandover, page, pageSize, hasMore });
  }
  // Sample operations do not imply permission to browse patient identities.
  const enriched=rows.slice(0, pageSize).map(({privateDataCiphertext,organizationId,assignedStaffId,...row})=>({
    ...row,
    canSubmitHandover: row.status === "COLLECTED" && access.staff.grants.some((grant) => grant.key === "collections.visit.record" && (grant.centreId === null || grant.centreId === row.centreId)) && (assignedStaffId === access.staff.staffUserId || access.staff.grants.some((grant) => grant.key === "collections.assign" && (grant.centreId === null || grant.centreId === row.centreId))),
    ...decryptOperationalData<{specimenType:string;requirementReference:string}>(privateDataCiphertext,operationalContext({organizationId,centreId:row.centreId,recordId:row.id},"specimen")),
  }));
  const output=enriched.map(({encryptionKeyId,nameCiphertext,patientId,centreId,...row})=>{
    const mayReadIdentity=access.staff.grants.some((grant)=>grant.key==="patients.read"&&(grant.centreId===null||grant.centreId===centreId));
    if(!mayReadIdentity)return {...row,centreId};
    const name=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:access.staff.organizationId,centreId,patientId});
    return {...row,patientId,centreId,patientName:name.firstName,patientLastName:name.lastName};
  });
  return Response.json({ specimens: output, page, pageSize, hasMore });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = actionSchema.safeParse(body); if (!parsed.success) return Response.json({ error: "invalid_sample_action", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const idempotencyKey = ["collect", "submit_for_receiving", "receive"].includes(parsed.data.action) ? request.headers.get("idempotency-key") : null;
  if (["collect", "submit_for_receiving", "receive"].includes(parsed.data.action) && !z.string().uuid().safeParse(idempotencyKey).success) return Response.json({ error: "valid_idempotency_key_required" }, { status: 400 });
  const permission = parsed.data.action === "collect" ? "samples.collect" : parsed.data.action === "submit_for_receiving" ? "collections.visit.record" : parsed.data.action === "receive" ? "samples.receive" : "samples.exceptions.manage";
  const base = await getApiAccess(permission); if (base.response) return base.response;
  const db = getDb();
  const jobId = parsed.data.action === "collect" ? parsed.data.jobId : undefined;
  const specimenId = parsed.data.action === "collect" ? undefined : parsed.data.specimenId;
  let context: { id: string; organizationId: string; centreId: string; assignedStaffId: string | null } | undefined;
  if (jobId) {
    const [job] = await db.select({ id: collectionJobs.id, organizationId: collectionJobs.organizationId, centreId: collectionJobs.centreId, assignedStaffId: collectionJobs.assignedStaffId }).from(collectionJobs).where(and(eq(collectionJobs.id, jobId), eq(collectionJobs.organizationId, base.staff.organizationId))).limit(1); context = job;
  } else if (specimenId) {
    const [specimen] = await db.select({ id: collectionJobs.id, organizationId: collectionJobs.organizationId, centreId: collectionJobs.centreId, assignedStaffId: collectionJobs.assignedStaffId }).from(specimens).innerJoin(collectionJobs, and(eq(collectionJobs.id, specimens.jobId), eq(collectionJobs.organizationId, specimens.organizationId), eq(collectionJobs.centreId, specimens.centreId))).where(and(eq(specimens.id, specimenId), eq(specimens.organizationId, base.staff.organizationId))).limit(1); context = specimen;
  }
  if (!context) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess(permission, context.centreId); if (access.response) return parsed.data.action === "submit_for_receiving" ? Response.json({ error: "not_found" }, { status: 404 }) : access.response;
  if (parsed.data.action === "collect" && !isAssignedCollector(access.staff.staffUserId, context.assignedStaffId, access.staff.grants, context.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (parsed.data.action === "submit_for_receiving" && context.assignedStaffId !== access.staff.staffUserId) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const result = await db.transaction(async (tx) => {
      if (parsed.data.action === "collect") {
        const [job] = await tx.select().from(collectionJobs).where(and(eq(collectionJobs.id, parsed.data.jobId), eq(collectionJobs.organizationId, access.staff.organizationId), eq(collectionJobs.centreId, context!.centreId))).for("update").limit(1);
        if (!job || job.status !== "IN_PROGRESS") throw new Error("collection_visit_not_started");
        const [duplicate] = await tx.select({ id: specimens.id, organizationId: specimens.organizationId, centreId: specimens.centreId, specimenNumber: specimens.specimenNumber, status: specimens.status, privateDataCiphertext: specimens.privateDataCiphertext, collectedByStaffId: specimens.collectedByStaffId, jobId: specimens.jobId, identityCheckConfirmed: specimens.identityCheckConfirmed, procedureApprovalId: specimens.collectionProcedureApprovalId, versionNumber: specimens.versionNumber }).from(specimens).where(and(eq(specimens.organizationId, job.organizationId), eq(specimens.idempotencyKey, idempotencyKey!))).limit(1);
        if (duplicate) {
          const existingPrivate = decryptOperationalData<{ specimenType: string; requirementReference: string }>(duplicate.privateDataCiphertext, operationalContext({ organizationId: duplicate.organizationId, centreId: duplicate.centreId, recordId: duplicate.id }, "specimen"));
          const [collectionEvent] = await tx.select({ id: sampleCustodyEvents.id, privateDataCiphertext: sampleCustodyEvents.privateDataCiphertext }).from(sampleCustodyEvents)
            .where(and(eq(sampleCustodyEvents.organizationId, duplicate.organizationId), eq(sampleCustodyEvents.centreId, duplicate.centreId), eq(sampleCustodyEvents.specimenId, duplicate.id), eq(sampleCustodyEvents.eventType, "COLLECTED"))).limit(1);
          if (!collectionEvent) throw new Error("idempotency_conflict");
          const collectionEvidence = decryptOperationalData<{ reason: string }>(collectionEvent.privateDataCiphertext, operationalContext({ organizationId: duplicate.organizationId, centreId: duplicate.centreId, recordId: collectionEvent.id }, "sample-custody-event"));
          if (!matchesSpecimenCollectionReplay({ jobId: duplicate.jobId, specimenType: existingPrivate.specimenType, requirementReference: existingPrivate.requirementReference, collectedByStaffId: duplicate.collectedByStaffId, identityCheckConfirmed: duplicate.identityCheckConfirmed, procedureApprovalId: duplicate.procedureApprovalId, reason: collectionEvidence.reason }, parsed.data, access.staff.staffUserId)) throw new Error("idempotency_conflict");
          return { id:duplicate.id,specimenNumber:duplicate.specimenNumber,status:duplicate.status,versionNumber:duplicate.versionNumber,replayed: true };
        }
        const [procedure] = await tx.select({ id: sampleProcedureApprovals.id }).from(sampleProcedureApprovals).where(and(eq(sampleProcedureApprovals.id, parsed.data.procedureApprovalId), eq(sampleProcedureApprovals.organizationId, job.organizationId), eq(sampleProcedureApprovals.centreId, job.centreId), eq(sampleProcedureApprovals.operation, "COLLECTION"), eq(sampleProcedureApprovals.status, "ACTIVE"))).limit(1);
        if (!procedure) throw new Error("approved_collection_procedure_required");
        const id = randomUUID();
        const privateDataCiphertext=encryptOperationalData({specimenType:parsed.data.specimenType,requirementReference:parsed.data.requirementReference},operationalContext({organizationId:job.organizationId,centreId:job.centreId,recordId:id},"specimen"));
        const [created] = await tx.insert(specimens).values({ id, organizationId: job.organizationId, centreId: job.centreId, jobId: job.id, orderId: job.orderId, patientId: job.patientId, specimenNumber: `RHC-S-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`, idempotencyKey: idempotencyKey!, privateDataCiphertext, status: "COLLECTED", identityCheckConfirmed: true, collectionProcedureApprovalId: procedure.id, collectedByStaffId: access.staff.staffUserId, receivingSubmissionRequired: true }).returning({ id: specimens.id, specimenNumber: specimens.specimenNumber, status: specimens.status, versionNumber: specimens.versionNumber });
        {const eventId=randomUUID();const reason=parsed.data.reason;await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: job.organizationId, centreId: job.centreId, specimenId: id, eventType: "COLLECTED", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({evidenceReference:null,reason},operationalContext({organizationId:job.organizationId,centreId:job.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId });}
        {const eventId=randomUUID();const reason="One specimen collection record added";await tx.insert(collectionJobEvents).values({ id:eventId,organizationId: job.organizationId, centreId: job.centreId, jobId: job.id, eventType: "COLLECTION_RECORDED", source: "STAFF",privateDataCiphertext:encryptOperationalData({reason,evidenceReference:null},operationalContext({organizationId:job.organizationId,centreId:job.centreId,recordId:eventId},"collection-job-event")), actorStaffId: access.staff.staffUserId });}
        await appendAuditEvent(tx, { organizationId: job.organizationId, centreId: job.centreId, actorStaffId: access.staff.staffUserId, action: "specimen.collected", entityType: "specimen", entityId: id, details: { specimenType: parsed.data.specimenType } }); return { ...created, replayed: false };
      }
      if (parsed.data.action === "submit_for_receiving") {
        const [job] = await tx.select({ id: collectionJobs.id, assignedStaffId: collectionJobs.assignedStaffId }).from(collectionJobs)
          .where(and(eq(collectionJobs.id, context!.id), eq(collectionJobs.organizationId, access.staff.organizationId), eq(collectionJobs.centreId, context!.centreId)))
          .for("update").limit(1);
        if (!job || job.assignedStaffId !== access.staff.staffUserId) throw new Error("not_found");
        const [specimen] = await tx.select().from(specimens).where(and(eq(specimens.id, parsed.data.specimenId), eq(specimens.organizationId, access.staff.organizationId), eq(specimens.centreId, context!.centreId))).for("update").limit(1);
        if (!specimen) throw new Error("not_found");
        const [priorKey] = await tx.select().from(sampleCustodyEvents).where(and(eq(sampleCustodyEvents.organizationId, access.staff.organizationId), eq(sampleCustodyEvents.idempotencyKey, idempotencyKey!))).limit(1);
        if (priorKey) {
          if (priorKey.specimenId !== specimen.id || priorKey.eventType !== "SUBMITTED_FOR_RECEIVING" || priorKey.actorStaffId !== access.staff.staffUserId) throw new Error("idempotency_conflict");
          const prior = decryptOperationalData<{ reason: string }>(priorKey.privateDataCiphertext, operationalContext({ organizationId: priorKey.organizationId, centreId: priorKey.centreId, recordId: priorKey.id }, "sample-custody-event"));
          if (prior.reason !== parsed.data.reason) throw new Error("idempotency_conflict");
          return { id: specimen.id, status: specimen.status, versionNumber: specimen.versionNumber, handoverSubmitted: true, replayed: true };
        }
        if (specimen.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
        if (specimen.status !== "COLLECTED") throw new Error("invalid_sample_transition");
        const [alreadySubmitted] = await tx.select({ id: sampleCustodyEvents.id }).from(sampleCustodyEvents).where(and(eq(sampleCustodyEvents.organizationId, specimen.organizationId), eq(sampleCustodyEvents.centreId, specimen.centreId), eq(sampleCustodyEvents.specimenId, specimen.id), eq(sampleCustodyEvents.eventType, "SUBMITTED_FOR_RECEIVING"))).limit(1);
        if (alreadySubmitted) return { id: specimen.id, status: specimen.status, versionNumber: specimen.versionNumber, handoverSubmitted: true, replayed: true };
        const [updated] = await tx.update(specimens).set({ versionNumber: specimen.versionNumber + 1, updatedAt: new Date() }).where(and(eq(specimens.id, specimen.id), eq(specimens.versionNumber, specimen.versionNumber))).returning({ id: specimens.id, status: specimens.status, versionNumber: specimens.versionNumber });
        const eventId = randomUUID();
        await tx.insert(sampleCustodyEvents).values({ id: eventId, organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: specimen.id, eventType: "SUBMITTED_FOR_RECEIVING", source: "STAFF_RECORDED", privateDataCiphertext: encryptOperationalData({ reason: parsed.data.reason }, operationalContext({ organizationId: specimen.organizationId, centreId: specimen.centreId, recordId: eventId }, "sample-custody-event")), actorStaffId: access.staff.staffUserId, idempotencyKey: idempotencyKey! });
        await appendAuditEvent(tx, { organizationId: specimen.organizationId, centreId: specimen.centreId, actorStaffId: access.staff.staffUserId, action: "specimen.submitted_for_receiving", entityType: "specimen", entityId: specimen.id, details: { status: specimen.status } });
        return { ...updated, handoverSubmitted: true, replayed: false };
      }
      const [specimen] = await tx.select().from(specimens).where(and(eq(specimens.id, parsed.data.specimenId), eq(specimens.organizationId, access.staff.organizationId), eq(specimens.centreId, context!.centreId))).for("update").limit(1);
      if (!specimen) throw new Error("not_found");
      if (parsed.data.action === "receive") {
        const [priorKey] = await tx.select().from(sampleCustodyEvents).where(and(eq(sampleCustodyEvents.organizationId, access.staff.organizationId), eq(sampleCustodyEvents.idempotencyKey, idempotencyKey!))).limit(1);
        if (priorKey) {
          if (priorKey.specimenId !== specimen.id || priorKey.eventType !== "RECEIVED_AT_RUDRA" || priorKey.actorStaffId !== access.staff.staffUserId) throw new Error("idempotency_conflict");
          const prior = decryptOperationalData<{ reason: string }>(priorKey.privateDataCiphertext, operationalContext({ organizationId: priorKey.organizationId, centreId: priorKey.centreId, recordId: priorKey.id }, "sample-custody-event"));
          if (prior.reason !== parsed.data.reason) throw new Error("idempotency_conflict");
          return { id: specimen.id, specimenNumber: specimen.specimenNumber, status: specimen.status, versionNumber: specimen.versionNumber, replayed: true };
        }
        if (specimen.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
        if (specimen.status !== "COLLECTED") throw new Error("invalid_sample_transition");
        if (specimen.receivingSubmissionRequired) {
          const [submission] = await tx.select({ id: sampleCustodyEvents.id }).from(sampleCustodyEvents).where(and(eq(sampleCustodyEvents.organizationId, specimen.organizationId), eq(sampleCustodyEvents.centreId, specimen.centreId), eq(sampleCustodyEvents.specimenId, specimen.id), eq(sampleCustodyEvents.eventType, "SUBMITTED_FOR_RECEIVING"))).limit(1);
          if (!submission) throw new Error("receiving_submission_required");
        }
        const [procedure] = await tx.select({ id: sampleProcedureApprovals.id }).from(sampleProcedureApprovals).where(and(eq(sampleProcedureApprovals.id, parsed.data.procedureApprovalId), eq(sampleProcedureApprovals.organizationId, specimen.organizationId), eq(sampleProcedureApprovals.centreId, specimen.centreId), eq(sampleProcedureApprovals.operation, "RECEIVING"), eq(sampleProcedureApprovals.status, "ACTIVE"))).limit(1);
        if (!procedure) throw new Error("approved_receiving_procedure_required");
        const [updated] = await tx.update(specimens).set({ status: "RECEIVED_AT_RUDRA", receivedAt: new Date(), receivedByStaffId: access.staff.staffUserId, receivingProcedureApprovalId: procedure.id, versionNumber: specimen.versionNumber + 1, updatedAt: new Date() }).where(and(eq(specimens.id, specimen.id), eq(specimens.versionNumber, specimen.versionNumber))).returning({ id: specimens.id, specimenNumber: specimens.specimenNumber, status: specimens.status, versionNumber: specimens.versionNumber });
        {const eventId=randomUUID();const reason=parsed.data.reason;await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: specimen.id, eventType: "RECEIVED_AT_RUDRA", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({evidenceReference:null,reason},operationalContext({organizationId:specimen.organizationId,centreId:specimen.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId, idempotencyKey: idempotencyKey! });}
        await appendAuditEvent(tx, { organizationId: specimen.organizationId, centreId: specimen.centreId, actorStaffId: access.staff.staffUserId, action: "specimen.received", entityType: "specimen", entityId: specimen.id, details: { status: updated.status } }); return { ...updated, replayed: false };
      }
      if (["DISPATCHED", "EXTERNAL_RECEIPT_RECORDED"].includes(specimen.status)) throw new Error("sample_transition_locked");
      const exceptionId=randomUUID();const exceptionPrivateDataCiphertext=encryptOperationalData({reason:parsed.data.reason,resolutionReference:null},operationalContext({organizationId:specimen.organizationId,centreId:specimen.centreId,recordId:exceptionId},"sample-exception"));const [exception] = await tx.insert(sampleExceptions).values({ id:exceptionId,organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: specimen.id, exceptionType: parsed.data.type,privateDataCiphertext:exceptionPrivateDataCiphertext, status: "OPEN", recordedByStaffId: access.staff.staffUserId }).returning({ id: sampleExceptions.id });
      await tx.update(specimens).set({ status: "EXCEPTION", versionNumber: specimen.versionNumber + 1, updatedAt: new Date() }).where(eq(specimens.id, specimen.id));
      {const eventId=randomUUID();const reason=parsed.data.reason;await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: specimen.id, eventType: "EXCEPTION_RECORDED", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({evidenceReference:null,reason},operationalContext({organizationId:specimen.organizationId,centreId:specimen.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId });}
      await appendAuditEvent(tx, { organizationId: specimen.organizationId, centreId: specimen.centreId, actorStaffId: access.staff.staffUserId, action: "specimen.exception_recorded", entityType: "specimen", entityId: specimen.id, details: { type: parsed.data.type, exceptionId: exception.id } }); return { exceptionId: exception.id, specimenId: specimen.id, status: "EXCEPTION" };
    });
    return Response.json({ result }, { status: parsed.data.action === "collect" && !("replayed" in result && result.replayed) ? 201 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : ""; const expected = ["collection_visit_not_started", "approved_collection_procedure_required", "idempotency_conflict", "version_conflict", "invalid_sample_transition", "approved_receiving_procedure_required", "sample_transition_locked", "receiving_submission_required", "not_found"];
    if (expected.includes(code)) return Response.json({ error: code }, { status: code === "version_conflict" || code === "idempotency_conflict" || code === "receiving_submission_required" ? 409 : code === "not_found" ? 404 : 400 });
    return Response.json({ error: "sample_operation_unavailable" }, { status: 409 });
  }
}
