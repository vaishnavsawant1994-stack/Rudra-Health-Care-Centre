import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { dispatchBatches, dispatchBatchItems, sampleCustodyEvents, sampleProcedureApprovals, specimens } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { dispatchCreateSchema } from "@/server/sample-policy";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 50);
  if (!Number.isInteger(page) || page < 1 || page > 10_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return Response.json({ error: "invalid_pagination" }, { status: 400 });
  const access = await getApiAccess("samples.read"); if (access.response) return access.response;
  const scopes = access.staff.grants.filter((g) => g.key === "samples.read").map((g) => g.centreId);
  const where = [eq(dispatchBatches.organizationId, access.staff.organizationId)];
  if (!scopes.includes(null)) where.push(scopes.length ? inArray(dispatchBatches.centreId, scopes.filter((id): id is string => Boolean(id))) : eq(dispatchBatches.centreId, "00000000-0000-0000-0000-000000000000"));
  const rows = await getDb().select({ id: dispatchBatches.id,organizationId:dispatchBatches.organizationId,centreId: dispatchBatches.centreId, batchNumber: dispatchBatches.batchNumber, status: dispatchBatches.status,privateDataCiphertext:dispatchBatches.privateDataCiphertext, handedOverAt: dispatchBatches.handedOverAt, versionNumber: dispatchBatches.versionNumber, createdAt: dispatchBatches.createdAt }).from(dispatchBatches).where(and(...where)).orderBy(desc(dispatchBatches.createdAt), desc(dispatchBatches.id)).limit(pageSize + 1).offset((page - 1) * pageSize);
  const hasMore = rows.length > pageSize;
  const batches=rows.slice(0, pageSize).map(({privateDataCiphertext,...batch})=>({...batch,...decryptOperationalData<{carrierReference:string|null;externalLabReference:string|null}>(privateDataCiphertext,operationalContext({organizationId:batch.organizationId,centreId:batch.centreId,recordId:batch.id},"dispatch-batch"))}));
  return Response.json({ batches, page, pageSize, hasMore });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = dispatchCreateSchema.safeParse(body); if (!parsed.success) return Response.json({ error: "invalid_dispatch_batch", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("samples.dispatch", parsed.data.centreId); if (access.response) return access.response;
  try {
    const batch = await getDb().transaction(async (tx) => {
      const [procedure] = await tx.select({ id: sampleProcedureApprovals.id }).from(sampleProcedureApprovals).where(and(eq(sampleProcedureApprovals.id, parsed.data.packingProcedureApprovalId), eq(sampleProcedureApprovals.organizationId, access.staff.organizationId), eq(sampleProcedureApprovals.centreId, parsed.data.centreId), eq(sampleProcedureApprovals.operation, "PACKING"), eq(sampleProcedureApprovals.status, "ACTIVE"))).limit(1);
      if (!procedure) throw new Error("approved_packing_procedure_required");
      const rows = await tx.select({id:specimens.id,organizationId:specimens.organizationId,centreId:specimens.centreId,status:specimens.status,dispatchBatchId:specimens.dispatchBatchId,versionNumber:specimens.versionNumber}).from(specimens).where(and(eq(specimens.organizationId, access.staff.organizationId), eq(specimens.centreId, parsed.data.centreId), inArray(specimens.id, parsed.data.specimenIds))).for("update");
      if (rows.length !== parsed.data.specimenIds.length || rows.some((row) => row.status !== "RECEIVED_AT_RUDRA" || row.dispatchBatchId)) throw new Error("specimens_not_ready");
      const id = randomUUID(); const [created] = await tx.insert(dispatchBatches).values({ id, organizationId: access.staff.organizationId, centreId: parsed.data.centreId, batchNumber: `RHC-D-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`, status: "PREPARING",privateDataCiphertext:encryptOperationalData({carrierReference:null,externalLabReference:null},operationalContext({organizationId:access.staff.organizationId,centreId:parsed.data.centreId,recordId:id},"dispatch-batch")), createdByStaffId: access.staff.staffUserId }).returning({ id: dispatchBatches.id, batchNumber: dispatchBatches.batchNumber, status: dispatchBatches.status, versionNumber: dispatchBatches.versionNumber });
      await tx.insert(dispatchBatchItems).values(rows.map((row) => ({ organizationId: row.organizationId, centreId: row.centreId, batchId: id, specimenId: row.id, addedByStaffId: access.staff.staffUserId })));
      for (const row of rows) {
        await tx.update(specimens).set({ status: "PACKED", dispatchBatchId: id, versionNumber: row.versionNumber + 1, updatedAt: new Date() }).where(eq(specimens.id, row.id));
        const eventId=randomUUID();await tx.insert(sampleCustodyEvents).values({ id:eventId,organizationId: row.organizationId, centreId: row.centreId, specimenId: row.id, eventType: "PACKED", source: "STAFF_RECORDED",privateDataCiphertext:encryptOperationalData({reason:parsed.data.reason,evidenceReference:null},operationalContext({organizationId:row.organizationId,centreId:row.centreId,recordId:eventId},"sample-custody-event")), actorStaffId: access.staff.staffUserId });
      }
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "dispatch_batch.created", entityType: "dispatch_batch", entityId: id, details: { specimenCount: rows.length } });
      return created;
    });
    return Response.json({ batch }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["approved_packing_procedure_required", "specimens_not_ready"].includes(code)) return Response.json({ error: code }, { status: 409 });
    return Response.json({ error: "dispatch_batch_unavailable" }, { status: 409 });
  }
}
