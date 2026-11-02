import { z } from "zod";

const campaignCode = z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const campaignName = z.string().trim().min(2).max(100);
const campaignDescription = z.string().trim().max(1000).nullable().optional();
const dates = { startsOn: z.iso.date().nullable().optional(), endsOn: z.iso.date().nullable().optional() };
export const campaignCreateSchema = z.object({ centreId: z.uuid(), idempotencyKey: z.uuid(), campaignCode, name: campaignName, description: campaignDescription, channel: z.enum(["WEBSITE", "REFERRAL", "PHONE", "WALK_IN", "PRINT", "SOCIAL", "OTHER"]), ...dates }).strict().refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, "End date must not precede start date.");
export const campaignUpdateSchema = z.object({ action: z.literal("UPDATE"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240), campaignCode: campaignCode.optional(), name: campaignName.optional(), description: campaignDescription, channel: z.enum(["WEBSITE", "REFERRAL", "PHONE", "WALK_IN", "PRINT", "SOCIAL", "OTHER"]).optional(), ...dates }).strict().refine((v) => Object.keys(v).some((key) => !["action", "expectedVersion", "reason"].includes(key)), "Provide a campaign change.").refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, "End date must not precede start date.");
export const campaignStatusSchema = z.object({ action: z.enum(["ACTIVATE", "COMPLETE", "CANCEL"]), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }).strict();
