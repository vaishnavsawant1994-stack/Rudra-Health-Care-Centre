import { z } from "zod";

const idempotencyKey = z.uuid();
const privateFields = { title: z.string().trim().min(2).max(120), body: z.string().trim().min(1).max(4000), internalNote: z.string().trim().max(600).nullable().optional() };
export const marketingContentCreateSchema = z.object({ centreId: z.uuid(), campaignId: z.uuid().nullable().optional(), channel: z.enum(["WEBSITE", "SOCIAL", "PRINT", "EMAIL", "WHATSAPP"]), contentType: z.enum(["POST", "STORY", "BANNER", "MESSAGE"]), ...privateFields, idempotencyKey }).strict();
export const marketingContentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("UPDATE"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240), ...privateFields, channel: z.enum(["WEBSITE", "SOCIAL", "PRINT", "EMAIL", "WHATSAPP"]).optional(), contentType: z.enum(["POST", "STORY", "BANNER", "MESSAGE"]).optional(), campaignId: z.uuid().nullable().optional() }).strict(),
  z.object({ action: z.enum(["SUBMIT_REVIEW", "APPROVE", "REQUEST_CHANGES", "CANCEL"]), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }).strict(),
  z.object({ action: z.literal("SCHEDULE"), expectedVersion: z.number().int().positive(), plannedPublishAt: z.iso.datetime(), reason: z.string().trim().min(3).max(240) }).strict(),
]);
export const marketingContentListSchema = z.object({ centreId: z.uuid(), status: z.enum(["ALL", "DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "CANCELLED"]).default("ALL") }).strict();
export type MarketingContentAction = z.infer<typeof marketingContentActionSchema>;
