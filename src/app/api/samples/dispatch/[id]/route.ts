import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { dispatchBatches, dispatchBatchItems, sampleCustodyEvents, sampleExternalReceipts, sampleProcedureApprovals, specimens } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { dispatchHandoverSchema, externalReceiptSchema } from "@/server/sample-policy";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { randomUUID } from "node:crypto";

const idSchema = z.uuid();
const actionSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("handover"), ...dispatchHandoverSchema.shape }), z.object({ action: z.literal("receipt"), ...externalReceiptSchema.shape })]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const base = await getApiAccess("samples.read"); if (base.response) return base.response;
  const [batch] = await getDb().select({id:dispatchBatches.id,organizationId:dispatchBatches.organizationId,centreId:dispatchBatches.centreId,batchNumber:dispatchBatches.batchNumber,status:dispatchBatches.status,privateDataCiphertext:dispatchBatches.privateDataCiphertext,handedOverByStaffId:dispatchBatches.handedOverByStaffId,handedOverAt:dispatchBatches.handedOverAt,transportProcedureApprovalId:dispatchBatches.transportProcedureApprovalId,versionNumber:dispatchBatches.versionNumber,createdByStaffId:dispatchBatches.createdByStaffId,createdAt:dispatchBatches.createdAt,updatedAt:dispatchBatches.updatedAt}).from(dispatchBatches).where(and(eq(dispatchBatches.id, id), eq(dispatchBatches.organizationId, base.staff.organizationId))).limit(1); if (!batch) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("samples.read", batch.centreId); if (access.response) return access.response;
  const [items, receipts] = await Promise.all([
    getDb().select({ id: specimens.id,organizationId:specimens.organizationId,centreId:specimens.centreId,specimenNumber: specimens.specimenNumber,privateDataCiphertext:specimens.privateDataCiphertext, status: specimens.status, collectedAt: specimens.collectedAt }).from(dispatchBatchItems).innerJoin(specimens, and(eq(specimens.id, dispatchBatchItems.specimenId), eq(specimens.organizationId, dispatchBatchItems.organizationId), eq(specimens.centreId, dispatchBatchItems.centreId))).where(and(eq(dispatchBatchItems.batchId, id), eq(dispatchBatchItems.organizationId, access.staff.organizationId))).orderBy(asc(specimens.specimenNumber)),
    getDb().select({ id:sampleExternalReceipts.id,organizationId:sampleExternalReceipts.organizationId,centreId:sampleExternalReceipts.centreId,privateDataCiphertext:sampleExternalReceipts.privateDataCiphertext,verificationStatus: sampleExternalReceipts.verificationStatus, recordedAt: sampleExternalReceipts.recordedAt, verifiedAt: sampleExternalReceipts.verifiedAt }).from(sampleExternalReceipts).where(and(eq(sampleExternalReceipts.batchId, id), eq(sampleExternalReceipts.organizationId, access.staff.organizationId))).orderBy(asc(sampleExternalReceipts.recordedAt)),
  ]);
  const {privateDataCiphertext,...batchData}=batch;const batchPrivate=decryptOperationalData<{carrierReference:string|null;externalLabReference:string|null}>(privateDataCiphertext,operationalContext({organizationId:batch.organizationId,centreId:batch.centreId,recordId:batch.id},"dispatch-batch"));
  const safeItems=items.map(({privateDataCiphertext,...item})=>({...item,...decryptOperationalData<{specimenType:string;requirementReference:string}>(privateDataCiphertext,operationalContext({organizationId:item.organizationId,centreId:item.centreId,recordId:item.id},"specimen"))}));
  const safeReceipts=receipts.map(({privateDataCiphertext,...receipt})=>({...receipt,...decryptOperationalData<{receiptReference:string;evidenceReference:string}>(privateDataCiphertext,operationalContext({organizationId:receipt.organizationId,centreId:receipt.centreId,recordId:receipt.id},"sample-external-receipt"))}));
  return Response.json({ batch:{...batchData,...batchPrivate}, items:safeItems, receipts:safeReceipts });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await context.params; if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = actionSchema.safeParse(body); if (!parsed.success || parsed.data.batchId !== id) return Response.json({ error: "invalid_dispatch_action" }, { status: 400 });
  const permission = parsed.data.action === "handover" ? "samples.dispatch" : "samples.external.verify";
  const base = await getApiAccess(permission); if (base.response) return base.response;
  const [initial] = await getDb().select({ organizationId: dispatchBatches.organizationId, centreId: dispatchBatches.centreId }).from(dispatchBatches).where(and(eq(dispatchBatches.id, id), eq(dispatchBatches.organizationId, base.staff.organizationId))).limit(1); if (!initial) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess(permission, initial.centreId); if (access.response) return access.response;
  try {
    const result = await getDb().transaction(async (tx) => {
      const [batch] = await tx.select({id:dispatchBatches.id,organizationId:dispatchBatches.organizationId,centreId:dispatchBatches.centreId,batchNumber:dispatchBatches.batchNumber,status:dispatchBatches.status,privateDataCiphertext:dispatchBatches.privateDataCiphertext,versionNumber:dispatchBatches.versionNumber}).from(dispatchBatches).where(and(eq(dispatchBatches.id, id), eq(dispatchBatches.organizationId, access.staff.organizationId), eq(dispatchBatches.centreId, initial.centreId))).for("update").limit(1);
      if (!batch) throw new Error("not_found");
      if (parsed.data.action === "handover") {
        if (batch.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict"); if (batch.status !== "PREPARING") throw new Error("invalid_batch_transition");
        const [procedure] = await tx.select({ id: sampleProcedureApprovals.id }).from(sampleProcedureApprovals).where(and(eq(sampleProcedureApprovals.id, parsed.data.procedureApprovalId), eq(sampleProcedureApprovals.organizationId, batch.organizationId), eq(sampleProcedureApprovals.centreId, batch.centreId), eq(sampleProcedureApprovals.operation, "TRANSPORT"), eq(sampleProcedureApprovals.status, "ACTIVE"))).limit(1); if (!procedure) throw new Error("approved_transport_procedure_required");
        const batchPrivate=decryptOperationalData<{carrierReference:string|null;externalLabReference:string|null}>(batch.privateDataCiphertext,operationalContext({organizationId:batch.organizationId,centreId:batch.centreId,recordId:batch.id},"dispatch-batch"));
        const nextPrivate={...batchPrivate,carrierReference:parsed.data.carrierReference,externalLabReference:parsed.data.externalLabReference??null};
        const [updated] = await tx.update(dispatchBatches).set({ status: "DISPATCHED", privateDataCiphertext:encryptOperationalData(nextPrivate,operationalContext({organizationId:batch.organizationId,centreId:batch.centreId,recordId:batch.id},"dispatch-batch")), transportProcedureApprovalId: procedure.id, handedOverByStaffId: access.staff.staffUserId, handedOverAt: new Date(), versionNumber: batch.versionNumber + 1, updatedAt: new Date() }).where(and(eq(dispatchBatches.id, id), eq(dispatchBatches.versionNumber, batch.versionNumber))).returning({ id: dispatchBatches.id, batchNumber: dispatchBatches.batchNumber, status: dispatchBatches.status, versionNumber: dispatchBatches.versionNumber });
        const rows = await tx.select({ specimenId: dispatchBatchItems.specimenId }).from(dispatchBatchItems).where(and(eq(dispatchBatchItems.batchId, id), eq(dispatchBatchItems.organizationId, batch.organizationId)));
        for (const row of rows) { await tx.update(specimens).set({ status: "DISPATCHED", versionNumber: sql`${specimens.versionNumber} + 1`, updatedAt: new Date() }).where(and(eq(specimens.id, row.specimenId), eq(specimens.status, "PACKED")));const eventId=randomUUID();await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: batch.organizationId, centreId: batch.centreId, specimenId: row.specimenId, eventType: "DISPATCHED", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({reason:parsed.data.reason,evidenceReference:parsed.data.carrierReference},operationalContext({organizationId:batch.organizationId,centreId:batch.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId }); }
        await appendAuditEvent(tx, { organizationId: batch.organizationId, centreId: batch.centreId, actorStaffId: access.staff.staffUserId, action: "dispatch_batch.handed_over", entityType: "dispatch_batch", entityId: id, details: { itemCount: rows.length } }); return updated;
      }
      if (batch.status !== "DISPATCHED") throw new Error("batch_not_dispatched");
      const receiptId=randomUUID();const [receipt] = await tx.insert(sampleExternalReceipts).values({ id:receiptId,organizationId: batch.organizationId, centreId: batch.centreId, batchId: id,privateDataCiphertext:encryptOperationalData({receiptReference:parsed.data.receiptReference,evidenceReference:parsed.data.evidenceReference},operationalContext({organizationId:batch.organizationId,centreId:batch.centreId,recordId:receiptId},"sample-external-receipt")), verificationStatus: "MANUALLY_VERIFIED", recordedByStaffId: access.staff.staffUserId, verifiedByStaffId: access.staff.staffUserId, verifiedAt: new Date() }).returning({ id: sampleExternalReceipts.id, verificationStatus: sampleExternalReceipts.verificationStatus });
      await tx.update(dispatchBatches).set({ status: "RECEIPT_RECORDED", versionNumber: batch.versionNumber + 1, updatedAt: new Date() }).where(and(eq(dispatchBatches.id, id), eq(dispatchBatches.versionNumber, batch.versionNumber)));
      const rows = await tx.select({ specimenId: dispatchBatchItems.specimenId }).from(dispatchBatchItems).where(and(eq(dispatchBatchItems.batchId, id), eq(dispatchBatchItems.organizationId, batch.organizationId)));
      for (const row of rows) { await tx.update(specimens).set({ status: "EXTERNAL_RECEIPT_RECORDED", versionNumber: sql`${specimens.versionNumber} + 1`, updatedAt: new Date() }).where(and(eq(specimens.id, row.specimenId), eq(specimens.status, "DISPATCHED")));const eventId=randomUUID();const reason="Manually verified external receipt evidence recorded";await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: batch.organizationId, centreId: batch.centreId, specimenId: row.specimenId, eventType: "EXTERNAL_RECEIPT_RECORDED", source: "EXTERNAL_EVIDENCE",privateDataCiphertext:encryptOperationalData({reason,evidenceReference:parsed.data.evidenceReference},operationalContext({organizationId:batch.organizationId,centreId:batch.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId }); }
      await appendAuditEvent(tx, { organizationId: batch.organizationId, centreId: batch.centreId, actorStaffId: access.staff.staffUserId, action: "dispatch_batch.external_receipt_recorded", entityType: "dispatch_batch", entityId: id, details: { itemCount: rows.length, verificationStatus: receipt.verificationStatus } }); return { id: receipt.id, status: receipt.verificationStatus };
    });
    return Response.json({ result });
  } catch (error) {
    const code = error instanceof Error ? error.message : ""; const expected = ["version_conflict", "invalid_batch_transition", "approved_transport_procedure_required", "batch_not_dispatched"];
    if (expected.includes(code)) return Response.json({ error: code }, { status: code === "version_conflict" ? 409 : 400 });
    return Response.json({ error: "dispatch_operation_unavailable" }, { status: 409 });
  }
}
