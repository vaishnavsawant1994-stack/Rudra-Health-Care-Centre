import { describe, expect, it } from "vitest";
import { canReviewMetropolisStatus, metropolisReferenceMatchesTarget, metropolisReferenceSchema, metropolisStatusActionSchema } from "./metropolis-policy";

const uuid = "a2c45f04-cc4b-4f13-9c87-837d9a91ed32";

describe("manual Metropolis evidence policy", () => {
  it("requires valid Rudra order and approved reference fields", () => {
    const base = { centreId: uuid, orderId: uuid, referenceType: "ORDER", externalReference: "EXT-104", evidenceReference: "DOC-5", reason: "Reviewed against partner document" };
    expect(metropolisReferenceSchema.safeParse(base).success).toBe(true);
    expect(metropolisReferenceSchema.safeParse({ ...base, orderId: "bad" }).success).toBe(false);
    expect(metropolisReferenceSchema.safeParse({ ...base, externalReference: " " }).success).toBe(false);
  });

  it("requires a Rudra specimen target for external specimen references", () => {
    expect(metropolisReferenceMatchesTarget("SPECIMEN")).toBe(false);
    expect(metropolisReferenceMatchesTarget("SPECIMEN", uuid)).toBe(true);
    expect(metropolisReferenceSchema.safeParse({ centreId: uuid, orderId: uuid, referenceType: "SPECIMEN", externalReference: "EXT-104", evidenceReference: "DOC-5", reason: "Evidence checked" }).success).toBe(false);
  });

  it("accepts only enumerated manually recorded status actions", () => {
    const status = { action: "record", orderId: uuid, statusCode: "PROCESSING_COMPLETE", occurredAt: "2026-11-13T08:00:00.000Z", externalReference: "EXT-104", evidenceReference: "DOC-5", reason: "Partner document reviewed" };
    expect(metropolisStatusActionSchema.safeParse(status).success).toBe(true);
    expect(metropolisStatusActionSchema.safeParse({ ...status, statusCode: "PROVIDER_CONFIRMED" }).success).toBe(false);
  });

  it("requires a second staff member to review the recorded statement", () => {
    expect(canReviewMetropolisStatus("staff-a", "staff-a")).toBe(false);
    expect(canReviewMetropolisStatus("staff-a", "staff-b")).toBe(true);
  });
});
