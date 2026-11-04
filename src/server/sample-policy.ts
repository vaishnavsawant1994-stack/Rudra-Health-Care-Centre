import { z } from "zod";

export const collectionJobCreateSchema = z.object({ appointmentId: z.uuid(), orderId: z.uuid() });
export const collectionJobActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), expectedVersion: z.number().int().positive(), staffUserId: z.uuid(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("accept"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("decline"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("start"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("arrive"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240), evidenceReference: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal("delay"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240), estimatedArrivalAt: z.iso.datetime().optional() }),
  z.object({ action: z.literal("complete"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("unsuccessful"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("cancel"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
]);
export const procedureSchema = z.object({ centreId: z.uuid(), operation: z.enum(["COLLECTION", "RECEIVING", "PACKING", "TRANSPORT"]), reference: z.string().trim().min(3).max(200) });
export const sampleCollectSchema = z.object({ jobId: z.uuid(), specimenType: z.string().trim().min(2).max(100), requirementReference: z.string().trim().min(3).max(200), identityCheckConfirmed: z.literal(true), procedureApprovalId: z.uuid(), reason: z.string().trim().min(3).max(240) });
export const sampleReceiveSchema = z.object({ specimenId: z.uuid(), expectedVersion: z.number().int().positive(), procedureApprovalId: z.uuid(), reason: z.string().trim().min(3).max(240) });
export const sampleHandoverSubmitSchema = z.object({ specimenId: z.uuid(), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) });
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

/** A direct exception link must still find its specimen after a later valid status transition. */
export function sampleDirectoryStatusFilter(view: z.infer<typeof sampleDirectoryViewSchema>, exceptionId?: string | null) {
  return view === "exceptions" && exceptionId ? null : sampleDirectoryStatuses(view);
}

export function assignedHandoverCentreScope(grants: { key: string; centreId: string | null }[]) {
  const scopes = grants.filter((grant) => grant.key === "collections.visit.record").map((grant) => grant.centreId);
  return scopes.includes(null) ? null : [...new Set(scopes.filter((centreId): centreId is string => centreId !== null))];
}

export function isAssignedCollector(actorId: string, assignedStaffId: string | null, grants: { key: string; centreId: string | null }[], centreId: string) {
  return assignedStaffId === actorId || grants.some((grant) => grant.key === "collections.assign" && (grant.centreId === null || grant.centreId === centreId));
}

/** Derives the current field-visit step from append-only events, including legacy visit-start events. */
export function collectionAttemptProgress(eventTypes: readonly string[]) {
  const travelStarts = eventTypes.filter((type) => type === "TRAVEL_STARTED" || type === "VISIT_STARTED").length;
  const arrivals = eventTypes.filter((type) => type === "ARRIVED").length;
  const failedAttempts = eventTypes.filter((type) => type === "ATTEMPT_FAILED").length;
  const hasOpenTravel = travelStarts > arrivals;
  const atDestination = arrivals > failedAttempts;
  return {
    canRecordArrival: hasOpenTravel,
    canRecordDelay: hasOpenTravel,
    atDestination,
    canRecordAttemptOutcome: atDestination,
  };
}

export function collectionVisitStage(status: string, eventTypes: readonly string[]): "TRAVELLING" | "ARRIVED" | null {
  if (status !== "IN_PROGRESS") return null;
  const progress = collectionAttemptProgress(eventTypes);
  if (progress.atDestination) return "ARRIVED";
  return progress.canRecordArrival ? "TRAVELLING" : null;
}

export function matchesSpecimenCollectionReplay(
  existing: { jobId: string; specimenType: string; requirementReference: string; collectedByStaffId: string; identityCheckConfirmed: boolean; procedureApprovalId: string; reason: string },
  request: z.infer<typeof sampleCollectSchema>,
  actorStaffId: string,
) {
  return existing.jobId === request.jobId
    && existing.specimenType === request.specimenType
    && existing.requirementReference === request.requirementReference
    && existing.collectedByStaffId === actorStaffId
    && existing.identityCheckConfirmed === request.identityCheckConfirmed
    && existing.procedureApprovalId === request.procedureApprovalId
    && existing.reason === request.reason;
}
