import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatPublicCampaignAttribution,
  legacyPublicEnquiryFingerprint,
  publicEnquiryCreateSchema,
  publicEnquiryFingerprint,
  publicEnquiryRequestContext,
  verifyPublicEnquiryFingerprint,
} from "@/server/public-enquiry-policy";

let previous: { keys?: string; active?: string; blind?: string };

beforeEach(() => {
  previous = {
    keys: process.env.RUDRA_FIELD_ENCRYPTION_KEYS,
    active: process.env.RUDRA_FIELD_ACTIVE_KEY_ID,
    blind: process.env.RUDRA_BLIND_INDEX_KEY,
  };
  process.env.RUDRA_BLIND_INDEX_KEY = Buffer.alloc(32, 9).toString("base64");
});

afterEach(() => {
  if (previous.keys === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
  else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = previous.keys;
  if (previous.active === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = previous.active;
  if (previous.blind === undefined) delete process.env.RUDRA_BLIND_INDEX_KEY;
  else process.env.RUDRA_BLIND_INDEX_KEY = previous.blind;
});

describe("public enquiry idempotency fingerprints", () => {
  const value = { firstName: "Synthetic", message: "Synthetic enquiry" };
  const context = publicEnquiryRequestContext({ organizationId: "org-a", centreId: "centre-a", idempotencyKey: "key-a" });

  it("accepts bounded UTM labels and rejects values that could carry personal or arbitrary text", () => {
    const base = { centreId: "00000000-0000-4000-8000-000000000001", firstName: "Synthetic", lastName: "Visitor", phone: "+919876543210", category: "GENERAL", message: "Synthetic question", responsePermission: false };
    expect(publicEnquiryCreateSchema.safeParse({ ...base, campaignAttribution: { source: "google-ads", medium: "cpc", campaign: "winter_2026" } }).success).toBe(true);
    expect(publicEnquiryCreateSchema.safeParse({ ...base, campaignAttribution: { source: "person@example.test" } }).success).toBe(false);
    expect(formatPublicCampaignAttribution({ source: "google-ads", medium: "cpc", campaign: "winter_2026" })).toBe("utm_source=google-ads;utm_medium=cpc;utm_campaign=winter_2026");
  });

  it("verifies the same request after operational key rotation when the old key is retained", () => {
    const oldKey = Buffer.alloc(32, 1).toString("base64");
    const newKey = Buffer.alloc(32, 2).toString("base64");
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "old";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ old: oldKey });
    const fingerprint = publicEnquiryFingerprint(value, context);

    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "new";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ old: oldKey, new: newKey });
    expect(verifyPublicEnquiryFingerprint(value, fingerprint, context)).toBe(true);
    expect(verifyPublicEnquiryFingerprint({ ...value, message: "Changed synthetic enquiry" }, fingerprint, context)).toBe(false);
  });

  it("binds the request fingerprint to its centre and idempotency key", () => {
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "active";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ active: Buffer.alloc(32, 3).toString("base64") });
    const fingerprint = publicEnquiryFingerprint(value, context);
    const otherCentre = publicEnquiryRequestContext({ organizationId: "org-a", centreId: "centre-b", idempotencyKey: "key-a" });
    const otherKey = publicEnquiryRequestContext({ organizationId: "org-a", centreId: "centre-a", idempotencyKey: "key-b" });
    expect(verifyPublicEnquiryFingerprint(value, fingerprint, otherCentre)).toBe(false);
    expect(verifyPublicEnquiryFingerprint(value, fingerprint, otherKey)).toBe(false);
  });

  it("accepts exact legacy fingerprints for rows created before keyring migration", () => {
    process.env.RUDRA_BLIND_INDEX_KEY = Buffer.alloc(32, 4).toString("base64");
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "active";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ active: Buffer.alloc(32, 5).toString("base64") });
    const legacy = legacyPublicEnquiryFingerprint(value);
    expect(verifyPublicEnquiryFingerprint(value, legacy, context)).toBe(true);
    expect(verifyPublicEnquiryFingerprint({ ...value, message: "Changed" }, legacy, context)).toBe(false);
  });
});
