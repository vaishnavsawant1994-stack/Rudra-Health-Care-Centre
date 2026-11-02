import { describe, expect, it } from "vitest";
import { campaignCreateSchema, campaignStatusSchema, campaignUpdateSchema } from "./marketing-campaign-policy";

const centreId = "2c61e074-b10e-42be-a8d3-b2f9cf9c081d";
const idempotencyKey = "8d077abd-e14e-41f0-bced-90410704e41f";

describe("internal marketing campaign validation", () => {
  it("accepts scoped draft metadata and rejects inverted dates", () => {
    expect(campaignCreateSchema.safeParse({ centreId, idempotencyKey, campaignCode: "NOV-26", name: "November screening", channel: "WEBSITE", startsOn: "2026-11-01", endsOn: "2026-11-30" }).success).toBe(true);
    expect(campaignCreateSchema.safeParse({ centreId, idempotencyKey, campaignCode: "NOV-26", name: "November screening", channel: "WEBSITE", startsOn: "2026-11-30", endsOn: "2026-11-01" }).success).toBe(false);
  });

  it("rejects public delivery and spend controls as unknown fields", () => {
    expect(campaignCreateSchema.safeParse({ centreId, idempotencyKey, campaignCode: "NOV-26", name: "November screening", channel: "SOCIAL", publish: true }).success).toBe(false);
  });

  it("requires a reason and expected version for status changes", () => {
    expect(campaignStatusSchema.safeParse({ action: "ACTIVATE", expectedVersion: 1, reason: "Approved internal tracking" }).success).toBe(true);
    expect(campaignStatusSchema.safeParse({ action: "ACTIVATE", expectedVersion: 1 }).success).toBe(false);
  });

  it("requires versioned, nonempty edits", () => {
    expect(campaignUpdateSchema.safeParse({ action: "UPDATE", expectedVersion: 2, name: "Renamed campaign", reason: "Corrected campaign name" }).success).toBe(true);
    expect(campaignUpdateSchema.safeParse({ action: "UPDATE", expectedVersion: 2, name: "Renamed campaign" }).success).toBe(false);
  });
});
