import { describe, expect, it } from "vitest";
import { governanceCreateSchema, governanceUpdateSchema } from "./communication-governance-policy";

const centreId = "e72d4a66-cbe0-42de-9232-1e28e594590f";
const idempotencyKey = "53e5e339-6d96-4a0b-97e0-596686eaa2fa";

describe("communications governance draft policy", () => {
  it("requires consent and human escalation for provider-policy drafts", () => {
    const base = { centreId, recordKind: "PROVIDER_POLICY" as const, channel: "WHATSAPP" as const, idempotencyKey, privateData: { displayName: "Synthetic routing policy", languages: ["en", "hi"], quietHoursStart: "21:00", quietHoursEnd: "09:00", routingInstructions: "Escalate service questions to an authorized centre staff member.", consentRequired: true, humanEscalation: true } };
    expect(governanceCreateSchema.safeParse(base).success).toBe(true);
    expect(governanceCreateSchema.safeParse({ ...base, privateData: { ...base.privateData, consentRequired: false } }).success).toBe(false);
    expect(governanceCreateSchema.safeParse({ ...base, privateData: { ...base.privateData, humanEscalation: false } }).success).toBe(false);
    expect(governanceCreateSchema.safeParse({ ...base, privateData: { ...base.privateData, languages: ["fr"] } }).success).toBe(false);
  });

  it("accepts encrypted knowledge drafts but contains no publish or approval transition", () => {
    const draft = { centreId, recordKind: "KNOWLEDGE" as const, idempotencyKey, privateData: { title: "Synthetic service guidance", category: "GENERAL_SERVICE" as const, sourceReference: "Approved source pending review", content: "Synthetic content for testing the knowledge draft validation and versioned review workflow.", expiresOn: null } };
    expect(governanceCreateSchema.safeParse(draft).success).toBe(true);
    expect(governanceUpdateSchema.safeParse({ centreId, recordKind: "KNOWLEDGE", expectedVersion: 1, privateData: draft.privateData }).success).toBe(true);
    expect(governanceCreateSchema.safeParse({ ...draft, privateData: { ...draft.privateData, content: "diagnose this patient" } }).success).toBe(true);
  });

  it("rejects provider secrets and external activation fields", () => {
    const data = { displayName: "Synthetic policy", languages: ["en"], quietHoursStart: "21:00", quietHoursEnd: "09:00", routingInstructions: "Human escalation is mandatory for unresolved requests.", consentRequired: true, humanEscalation: true, apiKey: "must-not-be-accepted", connectionState: "CONNECTED" };
    const result = governanceCreateSchema.safeParse({ centreId, recordKind: "PROVIDER_POLICY", channel: "VOICE", idempotencyKey, privateData: data });
    expect(result.success).toBe(false);
  });
});
