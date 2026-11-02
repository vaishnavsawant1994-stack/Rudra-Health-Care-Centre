import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { collectionJobs, sampleCustodyEvents, sampleExceptions, sampleProcedureApprovals, specimens } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { randomUUID } from "node:crypto";

const idSchema = z.uuid();
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const base = await getApiAccess("samples.read"); if (base.response) return base.response;
  const db = getDb(); const [specimen] = await db.select({ id: specimens.id, organizationId: specimens.organizationId, centreId: specimens.centreId, jobId: specimens.jobId, orderId: specimens.orderId, patientId: specimens.patientId, specimenNumber: specimens.specimenNumber,privateDataCiphertext:specimens.privateDataCiphertext, status: specimens.status, identityCheckConfirmed: specimens.identityCheckConfirmed, collectedAt: specimens.collectedAt, receivedAt: specimens.receivedAt, versionNumber: specimens.versionNumber, assignedStaffId: collectionJobs.assignedStaffId, jobNumber: collectionJobs.jobNumber }).from(specimens).innerJoin(collectionJobs, and(eq(collectionJobs.id, specimens.jobId), eq(collectionJobs.organizationId, specimens.organizationId), eq(collectionJobs.centreId, specimens.centreId))).where(and(eq(specimens.id, id), eq(specimens.organizationId, base.staff.organizationId))).limit(1);
  if (!specimen) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("samples.read", specimen.centreId); if (access.response) return access.response;
  if (specimen.assignedStaffId !== access.staff.staffUserId && !access.staff.grants.some((g) => g.key === "samples.receive" && (g.centreId === null || g.centreId === specimen.centreId)) && !access.staff.grants.some((g) => g.key === "collections.assign" && (g.centreId === null || g.centreId === specimen.centreId))) return Response.json({ error: "not_found" }, { status: 404 });
  const [events, exceptions] = await Promise.all([
    db.select({ id:sampleCustodyEvents.id,organizationId:sampleCustodyEvents.organizationId,centreId:sampleCustodyEvents.centreId,eventType: sampleCustodyEvents.eventType, source: sampleCustodyEvents.source,privateDataCiphertext:sampleCustodyEvents.privateDataCiphertext, recordedAt: sampleCustodyEvents.recordedAt }).from(sampleCustodyEvents).where(and(eq(sampleCustodyEvents.specimenId, id), eq(sampleCustodyEvents.organizationId, specimen.organizationId))).orderBy(asc(sampleCustodyEvents.recordedAt)),
    db.select({ id: sampleExceptions.id,organizationId:sampleExceptions.organizationId,centreId:sampleExceptions.centreId, type: sampleExceptions.exceptionType,privateDataCiphertext:sampleExceptions.privateDataCiphertext, status: sampleExceptions.status, createdAt: sampleExceptions.createdAt }).from(sampleExceptions).where(and(eq(sampleExceptions.specimenId, id), eq(sampleExceptions.organizationId, specimen.organizationId))).orderBy(asc(sampleExceptions.createdAt)),
  ]);
  const {privateDataCiphertext:specimenCipher,...specimenBase}=specimen;const specimenPrivate=decryptOperationalData<{specimenType:string;requirementReference:string}>(specimenCipher,operationalContext({organizationId:specimen.organizationId,centreId:specimen.centreId,recordId:id},"specimen"));
  const safeEvents=events.map(({privateDataCiphertext,...event})=>({...event,...decryptOperationalData<{reason:string;evidenceReference:string|null}>(privateDataCiphertext,operationalContext({organizationId:event.organizationId,centreId:event.centreId,recordId:event.id},"sample-custody-event"))}));
  const safeExceptions=exceptions.map(({privateDataCiphertext,...issue})=>({...issue,...decryptOperationalData<{reason:string;resolutionReference:string|null}>(privateDataCiphertext,operationalContext({organizationId:issue.organizationId,centreId:issue.centreId,recordId:issue.id},"sample-exception"))}));
  return Response.json({ specimen:{...specimenBase,...specimenPrivate}, events:safeEvents, exceptions:safeExceptions });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await context.params; if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = z.object({ action: z.enum(["resolve", "request_recollection"]), exceptionId: z.uuid(), reason: z.string().trim().min(3).max(240), resolutionReference: z.string().trim().min(3).max(200).optional() }).safeParse(body);
  if (!parsed.success || (parsed.data.action === "resolve" && !parsed.data.resolutionReference)) return Response.json({ error: "invalid_exception_action" }, { status: 400 });
  const permission = parsed.data.action === "resolve" ? "samples.exceptions.manage" : "samples.recollection.authorize";
  const base = await getApiAccess(permission); if (base.response) return base.response;
  const db = getDb(); const [specimen] = await db.select({ organizationId: specimens.organizationId, centreId: specimens.centreId, status: specimens.status }).from(specimens).where(and(eq(specimens.id, id), eq(specimens.organizationId, base.staff.organizationId))).limit(1); if (!specimen) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess(permission, specimen.centreId); if (access.response) return access.response;
  try {
    const result = await db.transaction(async (tx) => {
      const [issue] = await tx.select({id:sampleExceptions.id,organizationId:sampleExceptions.organizationId,centreId:sampleExceptions.centreId,status:sampleExceptions.status,privateDataCiphertext:sampleExceptions.privateDataCiphertext}).from(sampleExceptions).where(and(eq(sampleExceptions.id, parsed.data.exceptionId), eq(sampleExceptions.specimenId, id), eq(sampleExceptions.organizationId, access.staff.organizationId))).for("update").limit(1); if (!issue || issue.status !== "OPEN") throw new Error("exception_not_open");
      const issuePrivate=decryptOperationalData<{reason:string;resolutionReference:string|null}>(issue.privateDataCiphertext,operationalContext({organizationId:issue.organizationId,centreId:issue.centreId,recordId:issue.id},"sample-exception"));
      if (parsed.data.action === "request_recollection") {
        if (!["EXCEPTION", "RECOLLECTION_REQUIRED"].includes(specimen.status)) throw new Error("recollection_not_allowed");
        const [procedure] = await tx.select({ id: sampleProcedureApprovals.id }).from(sampleProcedureApprovals).where(and(eq(sampleProcedureApprovals.organizationId, specimen.organizationId), eq(sampleProcedureApprovals.centreId, specimen.centreId), eq(sampleProcedureApprovals.operation, "COLLECTION"), eq(sampleProcedureApprovals.status, "ACTIVE"))).limit(1); if (!procedure) throw new Error("approved_collection_procedure_required");
        await tx.update(sampleExceptions).set({ status: "RECOLLECTION_REQUESTED", resolvedByStaffId: access.staff.staffUserId,privateDataCiphertext:encryptOperationalData({...issuePrivate,resolutionReference:parsed.data.reason},operationalContext({organizationId:issue.organizationId,centreId:issue.centreId,recordId:issue.id},"sample-exception")), resolvedAt: new Date() }).where(eq(sampleExceptions.id, issue.id));
        await tx.update(specimens).set({ status: "RECOLLECTION_REQUIRED", versionNumber: sql`${specimens.versionNumber} + 1`, updatedAt: new Date() }).where(eq(specimens.id, id));
        {const eventId=randomUUID();await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: id, eventType: "RECOLLECTION_REQUESTED", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({reason:parsed.data.reason,evidenceReference:null},operationalContext({organizationId:specimen.organizationId,centreId:specimen.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId });}
      } else {
        await tx.update(sampleExceptions).set({ status: "RESOLVED", resolvedByStaffId: access.staff.staffUserId,privateDataCiphertext:encryptOperationalData({...issuePrivate,resolutionReference:parsed.data.resolutionReference!},operationalContext({organizationId:issue.organizationId,centreId:issue.centreId,recordId:issue.id},"sample-exception")), resolvedAt: new Date() }).where(eq(sampleExceptions.id, issue.id));
        {const eventId=randomUUID();await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: id, eventType: "CORRECTION_RECORDED", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({reason:parsed.data.reason,evidenceReference:parsed.data.resolutionReference},operationalContext({organizationId:specimen.organizationId,centreId:specimen.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId });}
      }
      await appendAuditEvent(tx, { organizationId: specimen.organizationId, centreId: specimen.centreId, actorStaffId: access.staff.staffUserId, action: parsed.data.action === "resolve" ? "specimen.exception_resolved" : "specimen.recollection_requested", entityType: "specimen", entityId: id, details: { exceptionId: issue.id } }); return { exceptionId: issue.id, action: parsed.data.action };
    });
    return Response.json({ result });
  } catch (error) {
    const code = error instanceof Error ? error.message : ""; if (["exception_not_open", "recollection_not_allowed", "approved_collection_procedure_required"].includes(code)) return Response.json({ error: code }, { status: 409 });
    return Response.json({ error: "exception_action_unavailable" }, { status: 409 });
  }
}
