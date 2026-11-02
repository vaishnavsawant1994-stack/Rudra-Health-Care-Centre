import { describe, expect, it } from "vitest";
import { marketingContentActionSchema, marketingContentCreateSchema } from "./marketing-content-policy";

const centreId = "6fd2e0a8-1d30-468d-aedf-68ca24123cb3";
const key = "2d6921e3-93b6-4ff8-933a-32836f0c6a4d";

describe("internal marketing content policy", () => {
  it("accepts private draft fields with a centre and idempotency key", () => {
    expect(marketingContentCreateSchema.safeParse({ centreId, channel: "SOCIAL", contentType: "POST", title: "Synthetic launch note", body: "Synthetic content only", idempotencyKey: key }).success).toBe(true);
  });

  it("rejects unknown fields and overlong content", () => {
    expect(marketingContentCreateSchema.safeParse({ centreId, channel: "SOCIAL", contentType: "POST", title: "Draft", body: "Copy", idempotencyKey: key, publishNow: true }).success).toBe(false);
    expect(marketingContentCreateSchema.safeParse({ centreId, channel: "SOCIAL", contentType: "POST", title: "Draft", body: "x".repeat(4001), idempotencyKey: key }).success).toBe(false);
  });

  it("requires an explicit reason for every workflow decision", () => {
    expect(marketingContentActionSchema.safeParse({ action: "APPROVE", expectedVersion: 1 }).success).toBe(false);
    expect(marketingContentActionSchema.safeParse({ action: "CANCEL", expectedVersion: 1, reason: "Approved synthetic cancellation" }).success).toBe(true);
  });
});
