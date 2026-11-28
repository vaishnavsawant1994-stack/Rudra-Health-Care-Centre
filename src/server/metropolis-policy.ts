import { z } from "zod";

const ref = z.string().trim().min(2).max(160);
const explanation = z.string().trim().min(3).max(240);
const id = z.uuid();

export const metropolisReferenceSchema = z.object({
  centreId: id,
  orderId: id,
  specimenId: id.optional(),
  referenceType: z.enum(["ORDER", "PATIENT", "SPECIMEN"]),
  externalReference: ref,
  evidenceReference: ref,
  reason: explanation,
}).refine((data) => data.referenceType !== "SPECIMEN" || Boolean(data.specimenId), { path: ["specimenId"], message: "A Rudra specimen is required for external specimen references." });

export const metropolisStatusSchema = z.object({
  orderId: id,
  specimenId: id.optional(),
  statusCode: z.enum(["SAMPLE_RECEIVED", "SAMPLE_REGISTERED", "PROCESSING_STARTED", "PROCESSING_COMPLETE", "REPORT_PENDING", "REPORT_AVAILABLE", "SAMPLE_REJECTED", "OTHER"]),
  occurredAt: z.iso.datetime(),
  externalReference: ref,
  evidenceReference: ref,
  reason: explanation,
  supersedesEventId: id.optional(),
});

export const metropolisStatusReviewSchema = z.object({
  statusEventId: id,
  decision: z.enum(["VERIFIED", "DISPUTED"]),
  evidenceReference: ref,
  reason: explanation,
});

export const metropolisStatusActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("record"), ...metropolisStatusSchema.shape }),
  z.object({ action: z.literal("review"), ...metropolisStatusReviewSchema.shape }),
]);

export function canReviewMetropolisStatus(recorderId: string, reviewerId: string) {
  return recorderId !== reviewerId;
}

export function metropolisReferenceMatchesTarget(referenceType: string, specimenId?: string | null) {
  return referenceType !== "SPECIMEN" || Boolean(specimenId);
}
