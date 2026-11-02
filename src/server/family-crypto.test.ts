import { afterEach, describe, expect, it } from "vitest";
import { blindIndexFamilyName, decryptFamilyValue, encryptFamilyValue } from "./family-crypto";

const prior = { keys: process.env.RUDRA_FIELD_ENCRYPTION_KEYS, id: process.env.RUDRA_FIELD_ACTIVE_KEY_ID, index: process.env.RUDRA_BLIND_INDEX_KEY };
afterEach(() => { if (prior.keys === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = prior.keys; if (prior.id === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = prior.id; if (prior.index === undefined) delete process.env.RUDRA_BLIND_INDEX_KEY; else process.env.RUDRA_BLIND_INDEX_KEY = prior.index; });

describe("family sensitive-data encryption", () => {
  it("encrypts family names and evidence with record and field binding", () => {
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "family-test"; process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ "family-test": Buffer.alloc(32, 41).toString("base64") }); process.env.RUDRA_BLIND_INDEX_KEY = Buffer.alloc(32, 42).toString("base64");
    const context = { organizationId: "org-1", centreId: "centre-1", recordId: "family-1" };
    const ciphertext = encryptFamilyValue("display-name", "Synthetic Family", context)!;
    expect(ciphertext).not.toContain("Synthetic Family"); expect(decryptFamilyValue("display-name", ciphertext, context)).toBe("Synthetic Family");
    expect(blindIndexFamilyName("Synthetic Family")).toBe(blindIndexFamilyName(" synthetic   family "));
    expect(() => decryptFamilyValue("member-evidence", ciphertext, context)).toThrow("family_data_integrity_failed");
    expect(() => decryptFamilyValue("display-name", ciphertext, { ...context, recordId: "family-2" })).toThrow("family_data_integrity_failed");
    const parts = ciphertext.split("."); parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
    expect(() => decryptFamilyValue("display-name", parts.join("."), context)).toThrow("family_data_integrity_failed");
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ "family-test": Buffer.alloc(32, 43).toString("base64") });
    expect(() => decryptFamilyValue("display-name", ciphertext, context)).toThrow("family_data_integrity_failed");
    delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    expect(() => decryptFamilyValue("display-name", ciphertext, context)).toThrow("family_encryption_key_unavailable");
  });
});
