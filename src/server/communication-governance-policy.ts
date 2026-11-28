import { z } from "zod";

export const providerPolicySchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  languages: z.array(z.enum(["en", "hi", "mr"])).min(1).max(3),
  quietHoursStart: z.iso.time({ precision: -1 }),
  quietHoursEnd: z.iso.time({ precision: -1 }),
  routingInstructions: z.string().trim().min(5).max(1000),
  consentRequired: z.literal(true),
  humanEscalation: z.literal(true),
}).strict();

export const knowledgeDraftSchema = z.object({
  title: z.string().trim().min(3).max(160),
  category: z.enum(["GENERAL_SERVICE", "CLINICAL"]),
  sourceReference: z.string().trim().min(3).max(300),
  content: z.string().trim().min(20).max(5000),
  expiresOn: z.iso.date().nullable(),
}).strict();

export const governanceCreateSchema = z.discriminatedUnion("recordKind", [
  z.object({ centreId: z.uuid(), recordKind: z.literal("PROVIDER_POLICY"), channel: z.enum(["WHATSAPP", "VOICE"]), privateData: providerPolicySchema, idempotencyKey: z.uuid() }).strict(),
  z.object({ centreId: z.uuid(), recordKind: z.literal("KNOWLEDGE"), privateData: knowledgeDraftSchema, idempotencyKey: z.uuid() }).strict(),
]);

export const governanceUpdateSchema = z.discriminatedUnion("recordKind", [
  z.object({ centreId: z.uuid(), recordKind: z.literal("PROVIDER_POLICY"), channel: z.enum(["WHATSAPP", "VOICE"]), expectedVersion: z.number().int().positive(), privateData: providerPolicySchema }).strict(),
  z.object({ centreId: z.uuid(), recordKind: z.literal("KNOWLEDGE"), expectedVersion: z.number().int().positive(), privateData: knowledgeDraftSchema }).strict(),
]);
