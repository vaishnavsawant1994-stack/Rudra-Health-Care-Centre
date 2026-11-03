import { and, asc, eq, inArray, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { collectionJobEvents, collectionJobs, patientContactSecrets, sampleCustodyEvents, sampleExceptions, sampleProcedureApprovals, specimens, patients } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { isAssignedCollector, sampleCollectSchema, sampleDirectoryStatuses, sampleDirectoryViewSchema, sampleExceptionSchema, sampleReceiveSchema } from "@/server/sample-policy";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { assignmentVisibility } from "@/server/assignment-visibility";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("collect"), ...sampleCollectSchema.shape }),
  z.object({ action: z.literal("receive"), ...sampleReceiveSchema.shape }),
  z.object({ action: z.literal("exception"), ...sampleExceptionSchema.shape }),
]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestedCentreId = params.get("centreId") ?? undefined;
  if (requestedCentreId && !z.string().uuid().safeParse(requestedCentreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const access = await getApiAccess("samples.read", requestedCentreId); if (access.response) return access.response;
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 50);
  if (!Number.isInteger(page) || page < 1 || page > 10_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return Response.json({ error: "invalid_pagination" }, { status: 400 });
  const parsedView = sampleDirectoryViewSchema.safeParse(params.get("view") ?? "all");
  if (!parsedView.success) return Response.json({ error: "invalid_sample_view" }, { status: 400 });
  const visibility = assignmentVisibility(access.staff.grants, "samples.read", "collections.assign", ["samples.collect", "collections.visit.record"]);
  const scope = visibility.readCentres;
  const clauses = [eq(specimens.organizationId, access.staff.organizationId)];
  if (requestedCentreId) clauses.push(eq(specimens.centreId, requestedCentreId));
  const statuses = sampleDirectoryStatuses(parsedView.data);
  if (statuses) clauses.push(inArray(specimens.status, [...statuses]));
  if (scope !== null) clauses.push(scope.length ? inArray(specimens.centreId, scope) : eq(specimens.centreId, "00000000-0000-0000-0000-000000000000"));
  if (visibility.restricted) {
    const permitted = [];
    if (visibility.unrestrictedCentres?.length) permitted.push(inArray(specimens.centreId, visibility.unrestrictedCentres));
    if (visibility.assignedOnlyCentres === null) permitted.push(eq(collectionJobs.assignedStaffId, access.staff.staffUserId));
    else if (visibility.assignedOnlyCentres.length) permitted.push(and(inArray(specimens.centreId, visibility.assignedOnlyCentres), eq(collectionJobs.assignedStaffId, access.staff.staffUserId)));
    clauses.push(permitted.length ? or(...permitted)! : eq(specimens.id, "00000000-0000-0000-0000-000000000000"));
  }
  const rows = await getDb().select({ id: specimens.id, organizationId:specimens.organizationId,centreId: specimens.centreId, jobId: specimens.jobId, orderId: specimens.orderId, patientId: specimens.patientId, encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,specimenNumber: specimens.specimenNumber,privateDataCiphertext:specimens.privateDataCiphertext, status: specimens.status, collectedAt: specimens.collectedAt, receivedAt: specimens.receivedAt, versionNumber: specimens.versionNumber }).from(specimens).innerJoin(collectionJobs, and(eq(collectionJobs.id, specimens.jobId), eq(collectionJobs.organizationId, specimens.organizationId), eq(collectionJobs.centreId, specimens.centreId))).innerJoin(patients, and(eq(patients.id, specimens.patientId), eq(patients.organizationId, specimens.organizationId), eq(patients.centreId, specimens.centreId))).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(...clauses)).orderBy(asc(specimens.collectedAt), asc(specimens.id)).limit(pageSize + 1).offset((page - 1) * pageSize);
  const hasMore = rows.length > pageSize;
  // Sample operations do not imply permission to browse patient identities.
  const enriched=rows.slice(0, pageSize).map(({privateDataCiphertext:_private,organizationId:_org,...row})=>row);
  const output=enriched.map(({encryptionKeyId,nameCiphertext,patientId,centreId,...row})=>{
    const mayReadIdentity=access.staff.grants.some((grant)=>grant.key==="patients.read"&&(grant.centreId===null||grant.centreId===centreId));
    if(!mayReadIdentity)return row;
    const name=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:access.staff.organizationId,centreId,patientId});
    return {...row,patientId,centreId,patientName:name.firstName,patientLastName:name.lastName};
  });
  return Response.json({ specimens: output, page, pageSize, hasMore });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = actionSchema.safeParse(body); if (!parsed.success) return Response.json({ error: "invalid_sample_action", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const idempotencyKey = parsed.data.action === "collect" ? request.headers.get("idempotency-key") : null;
  if (parsed.data.action === "collect" && !z.string().uuid().safeParse(idempotencyKey).success) return Response.json({ error: "valid_idempotency_key_required" }, { status: 400 });
  const permission = parsed.data.action === "collect" ? "samples.collect" : parsed.data.action === "receive" ? "samples.receive" : "samples.exceptions.manage";
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
  const access = await getApiAccess(permission, context.centreId); if (access.response) return access.response;
  if (parsed.data.action === "collect" && !isAssignedCollector(access.staff.staffUserId, context.assignedStaffId, access.staff.grants, context.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const result = await db.transaction(async (tx) => {
      if (parsed.data.action === "collect") {
        const [job] = await tx.select().from(collectionJobs).where(and(eq(collectionJobs.id, parsed.data.jobId), eq(collectionJobs.organizationId, access.staff.organizationId), eq(collectionJobs.centreId, context!.centreId))).for("update").limit(1);
        if (!job || job.status !== "IN_PROGRESS") throw new Error("collection_visit_not_started");
        const [duplicate] = await tx.select({ id: specimens.id,organizationId:specimens.organizationId,centreId:specimens.centreId, specimenNumber: specimens.specimenNumber, status: specimens.status,privateDataCiphertext:specimens.privateDataCiphertext, collectedByStaffId: specimens.collectedByStaffId, jobId: specimens.jobId, versionNumber: specimens.versionNumber }).from(specimens).where(and(eq(specimens.organizationId, job.organizationId), eq(specimens.idempotencyKey, idempotencyKey!))).limit(1);
        if (duplicate) {
          const existingPrivate=decryptOperationalData<{specimenType:string;requirementReference:string}>(duplicate.privateDataCiphertext,operationalContext({organizationId:duplicate.organizationId,centreId:duplicate.centreId,recordId:duplicate.id},"specimen"));
          if (duplicate.jobId !== job.id || existingPrivate.specimenType !== parsed.data.specimenType || existingPrivate.requirementReference !== parsed.data.requirementReference || duplicate.collectedByStaffId !== access.staff.staffUserId) throw new Error("idempotency_conflict");
          return { id:duplicate.id,specimenNumber:duplicate.specimenNumber,status:duplicate.status,versionNumber:duplicate.versionNumber,replayed: true };
        }
        const [procedure] = await tx.select({ id: sampleProcedureApprovals.id }).from(sampleProcedureApprovals).where(and(eq(sampleProcedureApprovals.id, parsed.data.procedureApprovalId), eq(sampleProcedureApprovals.organizationId, job.organizationId), eq(sampleProcedureApprovals.centreId, job.centreId), eq(sampleProcedureApprovals.operation, "COLLECTION"), eq(sampleProcedureApprovals.status, "ACTIVE"))).limit(1);
        if (!procedure) throw new Error("approved_collection_procedure_required");
        const id = randomUUID();
        const privateDataCiphertext=encryptOperationalData({specimenType:parsed.data.specimenType,requirementReference:parsed.data.requirementReference},operationalContext({organizationId:job.organizationId,centreId:job.centreId,recordId:id},"specimen"));
        const [created] = await tx.insert(specimens).values({ id, organizationId: job.organizationId, centreId: job.centreId, jobId: job.id, orderId: job.orderId, patientId: job.patientId, specimenNumber: `RHC-S-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`, idempotencyKey: idempotencyKey!, privateDataCiphertext, status: "COLLECTED", identityCheckConfirmed: true, collectionProcedureApprovalId: procedure.id, collectedByStaffId: access.staff.staffUserId }).returning({ id: specimens.id, specimenNumber: specimens.specimenNumber, status: specimens.status, versionNumber: specimens.versionNumber });
        {const eventId=randomUUID();const reason=parsed.data.reason;await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: job.organizationId, centreId: job.centreId, specimenId: id, eventType: "COLLECTED", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({evidenceReference:null,reason},operationalContext({organizationId:job.organizationId,centreId:job.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId });}
        {const eventId=randomUUID();const reason="One specimen collection record added";await tx.insert(collectionJobEvents).values({ id:eventId,organizationId: job.organizationId, centreId: job.centreId, jobId: job.id, eventType: "COLLECTION_RECORDED", source: "STAFF",privateDataCiphertext:encryptOperationalData({reason,evidenceReference:null},operationalContext({organizationId:job.organizationId,centreId:job.centreId,recordId:eventId},"collection-job-event")), actorStaffId: access.staff.staffUserId });}
        await appendAuditEvent(tx, { organizationId: job.organizationId, centreId: job.centreId, actorStaffId: access.staff.staffUserId, action: "specimen.collected", entityType: "specimen", entityId: id, details: { specimenType: parsed.data.specimenType } }); return { ...created, replayed: false };
      }
      const [specimen] = await tx.select().from(specimens).where(and(eq(specimens.id, parsed.data.specimenId), eq(specimens.organizationId, access.staff.organizationId), eq(specimens.centreId, context!.centreId))).for("update").limit(1);
      if (!specimen) throw new Error("not_found");
      if (parsed.data.action === "receive") {
        if (specimen.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
        if (specimen.status !== "COLLECTED") throw new Error("invalid_sample_transition");
        const [procedure] = await tx.select({ id: sampleProcedureApprovals.id }).from(sampleProcedureApprovals).where(and(eq(sampleProcedureApprovals.id, parsed.data.procedureApprovalId), eq(sampleProcedureApprovals.organizationId, specimen.organizationId), eq(sampleProcedureApprovals.centreId, specimen.centreId), eq(sampleProcedureApprovals.operation, "RECEIVING"), eq(sampleProcedureApprovals.status, "ACTIVE"))).limit(1);
        if (!procedure) throw new Error("approved_receiving_procedure_required");
        const [updated] = await tx.update(specimens).set({ status: "RECEIVED_AT_RUDRA", receivedAt: new Date(), receivedByStaffId: access.staff.staffUserId, receivingProcedureApprovalId: procedure.id, versionNumber: specimen.versionNumber + 1, updatedAt: new Date() }).where(and(eq(specimens.id, specimen.id), eq(specimens.versionNumber, specimen.versionNumber))).returning({ id: specimens.id, specimenNumber: specimens.specimenNumber, status: specimens.status, versionNumber: specimens.versionNumber });
        {const eventId=randomUUID();const reason=parsed.data.reason;await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: specimen.id, eventType: "RECEIVED_AT_RUDRA", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({evidenceReference:null,reason},operationalContext({organizationId:specimen.organizationId,centreId:specimen.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId });}
        await appendAuditEvent(tx, { organizationId: specimen.organizationId, centreId: specimen.centreId, actorStaffId: access.staff.staffUserId, action: "specimen.received", entityType: "specimen", entityId: specimen.id, details: { status: updated.status } }); return updated;
      }
      if (["DISPATCHED", "EXTERNAL_RECEIPT_RECORDED"].includes(specimen.status)) throw new Error("sample_transition_locked");
      const exceptionId=randomUUID();const exceptionPrivateDataCiphertext=encryptOperationalData({reason:parsed.data.reason,resolutionReference:null},operationalContext({organizationId:specimen.organizationId,centreId:specimen.centreId,recordId:exceptionId},"sample-exception"));const [exception] = await tx.insert(sampleExceptions).values({ id:exceptionId,organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: specimen.id, exceptionType: parsed.data.type,privateDataCiphertext:exceptionPrivateDataCiphertext, status: "OPEN", recordedByStaffId: access.staff.staffUserId }).returning({ id: sampleExceptions.id });
      await tx.update(specimens).set({ status: "EXCEPTION", versionNumber: specimen.versionNumber + 1, updatedAt: new Date() }).where(eq(specimens.id, specimen.id));
      {const eventId=randomUUID();const reason=parsed.data.reason;await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: specimen.id, eventType: "EXCEPTION_RECORDED", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({evidenceReference:null,reason},operationalContext({organizationId:specimen.organizationId,centreId:specimen.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId });}
      await appendAuditEvent(tx, { organizationId: specimen.organizationId, centreId: specimen.centreId, actorStaffId: access.staff.staffUserId, action: "specimen.exception_recorded", entityType: "specimen", entityId: specimen.id, details: { type: parsed.data.type, exceptionId: exception.id } }); return { exceptionId: exception.id, specimenId: specimen.id, status: "EXCEPTION" };
    });
    return Response.json({ result }, { status: parsed.data.action === "collect" && !("replayed" in result && result.replayed) ? 201 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : ""; const expected = ["collection_visit_not_started", "approved_collection_procedure_required", "idempotency_conflict", "version_conflict", "invalid_sample_transition", "approved_receiving_procedure_required", "sample_transition_locked"];
    if (expected.includes(code)) return Response.json({ error: code }, { status: code === "version_conflict" || code === "idempotency_conflict" ? 409 : 400 });
    return Response.json({ error: "sample_operation_unavailable" }, { status: 409 });
  }
}
