import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { centrePublicProfileSchema, decryptCentrePublicProfile, encryptCentrePublicProfile } from "./centre-public-profile";

const organizationId = randomUUID();
const centreId = randomUUID();
const profile = { displayName: "Synthetic Centre", address: "Synthetic address", phone: "+910000000003", email: "centre@invalid.test", serviceArea: null, openingHours: null, published: true };
const key = randomBytes(32).toString("base64");

afterEach(() => { delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; });

describe("public centre profile boundary", () => {
  it("requires an explicit public location before publication", () => {
    expect(centrePublicProfileSchema.safeParse({ ...profile, address: null }).success).toBe(false);
    expect(centrePublicProfileSchema.safeParse({ ...profile, address: null, serviceArea: "Area" }).success).toBe(true);
  });

  it("rejects unrecognized fields and invalid email addresses", () => {
    expect(centrePublicProfileSchema.safeParse({ ...profile, privatePatientNotes: "do not accept" }).success).toBe(false);
    expect(centrePublicProfileSchema.safeParse({ ...profile, email: "not-an-email" }).success).toBe(false);
  });

  it("encrypts data with centre-bound authenticated context", () => {
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ test_key: key });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "test_key";
    const ciphertext = encryptCentrePublicProfile(profile, organizationId, centreId);
    expect(ciphertext).not.toContain(profile.address);
    expect(decryptCentrePublicProfile(ciphertext, organizationId, centreId)).toEqual(profile);
    expect(() => decryptCentrePublicProfile(ciphertext, organizationId, randomUUID())).toThrow("operational_data_integrity_failed");
  });

  it("does not encrypt or publish if the key is unavailable", () => {
    expect(() => encryptCentrePublicProfile(profile, organizationId, centreId)).toThrow("operational_encryption_key_unavailable");
  });
});
