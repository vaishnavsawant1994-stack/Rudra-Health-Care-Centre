import { z } from "zod";

export const collectionJobCreateSchema = z.object({ appointmentId: z.uuid(), orderId: z.uuid() });
export const collectionJobActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), expectedVersion: z.number().int().positive(), staffUserId: z.uuid(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("start"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("arrive"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240), evidenceReference: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal("complete"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("unsuccessful"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("cancel"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
]);
export const procedureSchema = z.object({ centreId: z.uuid(), operation: z.enum(["COLLECTION", "RECEIVING", "PACKING", "TRANSPORT"]), reference: z.string().trim().min(3).max(200) });
export const sampleCollectSchema = z.object({ jobId: z.uuid(), specimenType: z.string().trim().min(2).max(100), requirementReference: z.string().trim().min(3).max(200), identityCheckConfirmed: z.literal(true), procedureApprovalId: z.uuid(), reason: z.string().trim().min(3).max(240) });
export const sampleReceiveSchema = z.object({ specimenId: z.uuid(), expectedVersion: z.number().int().positive(), procedureApprovalId: z.uuid(), reason: z.string().trim().min(3).max(240) });
export const sampleExceptionSchema = z.object({ specimenId: z.uuid(), type: z.enum(["MISSING_LABEL", "DAMAGED", "MISSING_SPECIMEN", "HANDOVER_DISCREPANCY", "REJECTED", "OTHER"]), reason: z.string().trim().min(3).max(240) });
export const dispatchCreateSchema = z.object({ centreId: z.uuid(), specimenIds: z.array(z.uuid()).min(1).max(100), packingProcedureApprovalId: z.uuid(), reason: z.string().trim().min(3).max(240) });
export const dispatchHandoverSchema = z.object({ batchId: z.uuid(), expectedVersion: z.number().int().positive(), carrierReference: z.string().trim().min(2).max(200), externalLabReference: z.string().trim().max(200).optional(), procedureApprovalId: z.uuid(), reason: z.string().trim().min(3).max(240) });
export const externalReceiptSchema = z.object({ batchId: z.uuid(), receiptReference: z.string().trim().min(2).max(200), evidenceReference: z.string().trim().min(3).max(200), reason: z.string().trim().min(3).max(240) });

export const sampleDirectoryViewSchema = z.enum(["all", "receiving", "handover", "exceptions"]);
export function sampleDirectoryStatuses(view: z.infer<typeof sampleDirectoryViewSchema>) {
  if (view === "receiving" || view === "handover") return ["COLLECTED"] as const;
  if (view === "exceptions") return ["EXCEPTION", "RECOLLECTION_REQUIRED"] as const;
  return null;
}

export function isAssignedCollector(actorId: string, assignedStaffId: string | null, grants: { key: string; centreId: string | null }[], centreId: string) {
  return assignedStaffId === actorId || grants.some((grant) => grant.key === "collections.assign" && (grant.centreId === null || grant.centreId === centreId));
}
