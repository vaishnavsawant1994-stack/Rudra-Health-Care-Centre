import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { collectionJobs, sampleCustodyEvents, sampleExceptions, specimens } from "@/db/schema";
import { assignedHandoverCentreScope } from "@/server/sample-policy";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const fieldExceptionSchema = z.object({
  centreId: z.uuid(),
  specimenNumber: z.string().trim().min(3).max(32),
  expectedVersion: z.number().int().positive(),
  type: z.enum(["MISSING_LABEL", "DAMAGED", "MISSING_SPECIMEN", "HANDOVER_DISCREPANCY", "OTHER"]),
  reason: z.string().trim().min(3).max(240),
});

/** Minimal, assigned-only exception queue for field staff. Never returns patient or private evidence. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestedCentreId = params.get("centreId") ?? undefined;
  if (requestedCentreId && !z.uuid().safeParse(requestedCentreId).success) {
    return Response.json({ error: "invalid_centre" }, { status: 400 });
  }
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 50);
  if (!Number.isInteger(page) || page < 1 || page > 10_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return Response.json({ error: "invalid_pagination" }, { status: 400 });
  }

  const access = await getApiAccess("collections.visit.record", requestedCentreId);
  if (access.response) return access.response;

  const clauses = [
    eq(sampleExceptions.organizationId, access.staff.organizationId),
    eq(sampleExceptions.status, "OPEN"),
    eq(collectionJobs.assignedStaffId, access.staff.staffUserId),
  ];
  if (requestedCentreId) clauses.push(eq(sampleExceptions.centreId, requestedCentreId));
  const permittedCentres = assignedHandoverCentreScope(access.staff.grants);
  if (permittedCentres !== null) {
    if (permittedCentres.length === 0) return Response.json({ exceptions: [], eligibleSpecimens: [], page, pageSize, hasMore: false });
    clauses.push(inArray(sampleExceptions.centreId, permittedCentres));
  }

  const eligibleClauses = [
    eq(specimens.organizationId, access.staff.organizationId),
    eq(specimens.status, "COLLECTED"),
    eq(collectionJobs.assignedStaffId, access.staff.staffUserId),
    sql`NOT EXISTS (SELECT 1 FROM sample_exceptions open_exception WHERE open_exception.organization_id = ${specimens.organizationId} AND open_exception.centre_id = ${specimens.centreId} AND open_exception.specimen_id = ${specimens.id} AND open_exception.status = 'OPEN')`,
    sql`NOT EXISTS (SELECT 1 FROM sample_custody_events submitted WHERE submitted.organization_id = ${specimens.organizationId} AND submitted.centre_id = ${specimens.centreId} AND submitted.specimen_id = ${specimens.id} AND submitted.event_type = 'SUBMITTED_FOR_RECEIVING')`,
  ];
  if (requestedCentreId) eligibleClauses.push(eq(specimens.centreId, requestedCentreId));
  if (permittedCentres !== null) eligibleClauses.push(inArray(specimens.centreId, permittedCentres));

  const rows = await getDb().select({
    id: sampleExceptions.id,
    centreId: sampleExceptions.centreId,
    specimenId: sampleExceptions.specimenId,
    exceptionType: sampleExceptions.exceptionType,
    exceptionStatus: sampleExceptions.status,
    recordedAt: sampleExceptions.createdAt,
    specimenNumber: specimens.specimenNumber,
    specimenStatus: specimens.status,
  }).from(sampleExceptions)
    .innerJoin(specimens, and(
      eq(specimens.id, sampleExceptions.specimenId),
      eq(specimens.organizationId, sampleExceptions.organizationId),
      eq(specimens.centreId, sampleExceptions.centreId),
    ))
    .innerJoin(collectionJobs, and(
      eq(collectionJobs.id, specimens.jobId),
      eq(collectionJobs.organizationId, specimens.organizationId),
      eq(collectionJobs.centreId, specimens.centreId),
    ))
    .where(and(...clauses))
    .orderBy(asc(sampleExceptions.createdAt), asc(sampleExceptions.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);

  const eligibleRows = await getDb().select({
    centreId: specimens.centreId,
    specimenNumber: specimens.specimenNumber,
    specimenStatus: specimens.status,
    versionNumber: specimens.versionNumber,
    collectedAt: specimens.collectedAt,
  }).from(specimens)
    .innerJoin(collectionJobs, and(
      eq(collectionJobs.id, specimens.jobId),
      eq(collectionJobs.organizationId, specimens.organizationId),
      eq(collectionJobs.centreId, specimens.centreId),
    ))
    .where(and(...eligibleClauses))
    .orderBy(asc(specimens.collectedAt), asc(specimens.specimenNumber))
    .limit(100);

  const hasMore = rows.length > pageSize;
  const exceptions = rows.slice(0, pageSize).map((item) => ({
    centreId: item.centreId,
    exceptionType: item.exceptionType,
    exceptionStatus: item.exceptionStatus,
    recordedAt: item.recordedAt,
    specimenNumber: item.specimenNumber,
    specimenStatus: item.specimenStatus,
  }));
  return Response.json({ exceptions, eligibleSpecimens: eligibleRows, page, pageSize, hasMore });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = fieldExceptionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_field_exception", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!z.uuid().safeParse(idempotencyKey).success) return Response.json({ error: "valid_idempotency_key_required" }, { status: 400 });

  const access = await getApiAccess("collections.visit.record", parsed.data.centreId);
  if (access.response) return access.response;
  const db = getDb();
  const [initial] = await db.select({
    id: specimens.id, organizationId: specimens.organizationId, centreId: specimens.centreId, jobId: specimens.jobId,
    specimenNumber: specimens.specimenNumber, versionNumber: specimens.versionNumber, status: specimens.status,
    assignedStaffId: collectionJobs.assignedStaffId,
  }).from(specimens).innerJoin(collectionJobs, and(
    eq(collectionJobs.id, specimens.jobId),
    eq(collectionJobs.organizationId, specimens.organizationId),
    eq(collectionJobs.centreId, specimens.centreId),
  )).where(and(
    eq(specimens.organizationId, access.staff.organizationId),
    eq(specimens.centreId, parsed.data.centreId),
    eq(specimens.specimenNumber, parsed.data.specimenNumber),
  )).limit(1);
  if (!initial || initial.assignedStaffId !== access.staff.staffUserId) return Response.json({ error: "not_found" }, { status: 404 });

  try {
    const result = await db.transaction(async (tx) => {
      const [job] = await tx.select({ id: collectionJobs.id, assignedStaffId: collectionJobs.assignedStaffId })
        .from(collectionJobs).where(and(
          eq(collectionJobs.id, initial.jobId), eq(collectionJobs.organizationId, access.staff.organizationId), eq(collectionJobs.centreId, initial.centreId),
        )).for("update").limit(1);
      if (!job || job.assignedStaffId !== access.staff.staffUserId) throw new Error("not_found");
      const [specimen] = await tx.select().from(specimens).where(and(
        eq(specimens.id, initial.id), eq(specimens.organizationId, access.staff.organizationId), eq(specimens.centreId, initial.centreId),
      )).for("update").limit(1);
      if (!specimen) throw new Error("not_found");

      const [prior] = await tx.select().from(sampleCustodyEvents).where(and(
        eq(sampleCustodyEvents.organizationId, specimen.organizationId), eq(sampleCustodyEvents.idempotencyKey, idempotencyKey!),
      )).limit(1);
      if (prior) {
        if (prior.specimenId !== specimen.id || prior.eventType !== "EXCEPTION_RECORDED" || prior.actorStaffId !== access.staff.staffUserId) throw new Error("idempotency_conflict");
        const previous = decryptOperationalData<{ exceptionId: string; type: string; reason: string }>(prior.privateDataCiphertext, operationalContext({ organizationId: prior.organizationId, centreId: prior.centreId, recordId: prior.id }, "sample-custody-event"));
        if (previous.type !== parsed.data.type || previous.reason !== parsed.data.reason) throw new Error("idempotency_conflict");
        return { exceptionId: previous.exceptionId, specimenNumber: specimen.specimenNumber, status: specimen.status, versionNumber: specimen.versionNumber, replayed: true };
      }
      if (specimen.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
      if (specimen.status !== "COLLECTED") throw new Error("invalid_sample_transition");
      const [submission] = await tx.select({ id: sampleCustodyEvents.id }).from(sampleCustodyEvents).where(and(
        eq(sampleCustodyEvents.organizationId, specimen.organizationId), eq(sampleCustodyEvents.centreId, specimen.centreId),
        eq(sampleCustodyEvents.specimenId, specimen.id), eq(sampleCustodyEvents.eventType, "SUBMITTED_FOR_RECEIVING"),
      )).limit(1);
      if (submission) throw new Error("sample_already_submitted");

      const exceptionId = randomUUID();
      const eventId = randomUUID();
      const exceptionPrivateDataCiphertext = encryptOperationalData(
        { reason: parsed.data.reason, resolutionReference: null },
        operationalContext({ organizationId: specimen.organizationId, centreId: specimen.centreId, recordId: exceptionId }, "sample-exception"),
      );
      const eventPrivateDataCiphertext = encryptOperationalData(
        { reason: parsed.data.reason, evidenceReference: null, exceptionId, type: parsed.data.type },
        operationalContext({ organizationId: specimen.organizationId, centreId: specimen.centreId, recordId: eventId }, "sample-custody-event"),
      );
      await tx.insert(sampleExceptions).values({
        id: exceptionId, organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: specimen.id,
        exceptionType: parsed.data.type, privateDataCiphertext: exceptionPrivateDataCiphertext, status: "OPEN", recordedByStaffId: access.staff.staffUserId,
      });
      const [updated] = await tx.update(specimens).set({ status: "EXCEPTION", versionNumber: specimen.versionNumber + 1, updatedAt: new Date() })
        .where(and(eq(specimens.id, specimen.id), eq(specimens.versionNumber, specimen.versionNumber)))
        .returning({ status: specimens.status, versionNumber: specimens.versionNumber });
      if (!updated) throw new Error("version_conflict");
      await tx.insert(sampleCustodyEvents).values({
        id: eventId, organizationId: specimen.organizationId, centreId: specimen.centreId, specimenId: specimen.id,
        eventType: "EXCEPTION_RECORDED", source: "STAFF_RECORDED", privateDataCiphertext: eventPrivateDataCiphertext,
        actorStaffId: access.staff.staffUserId, idempotencyKey: idempotencyKey!,
      });
      await appendAuditEvent(tx, {
        organizationId: specimen.organizationId, centreId: specimen.centreId, actorStaffId: access.staff.staffUserId,
        action: "specimen.exception_recorded", entityType: "specimen", entityId: specimen.id,
        details: { type: parsed.data.type, status: updated.status },
      });
      return { exceptionId, specimenNumber: specimen.specimenNumber, ...updated, replayed: false };
    });
    return Response.json({ result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["idempotency_conflict", "version_conflict", "sample_already_submitted"].includes(code)) return Response.json({ error: code }, { status: 409 });
    if (["not_found"].includes(code)) return Response.json({ error: code }, { status: 404 });
    if (["invalid_sample_transition"].includes(code)) return Response.json({ error: code }, { status: 400 });
    return Response.json({ error: "field_exception_unavailable" }, { status: 409 });
  }
}
