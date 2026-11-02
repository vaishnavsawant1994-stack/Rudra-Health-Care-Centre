import { afterEach, describe, expect, it } from "vitest";
import { blindIndexLeadContact, decryptLeadPrivateData, decryptLeadValue, encryptLeadPrivateData, encryptLeadValue } from "./lead-crypto";

const previous = { keys: process.env.RUDRA_FIELD_ENCRYPTION_KEYS, id: process.env.RUDRA_FIELD_ACTIVE_KEY_ID, index: process.env.RUDRA_BLIND_INDEX_KEY };
afterEach(() => {
  if (previous.keys === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = previous.keys;
  if (previous.id === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = previous.id;
  if (previous.index === undefined) delete process.env.RUDRA_BLIND_INDEX_KEY; else process.env.RUDRA_BLIND_INDEX_KEY = previous.index;
});

describe("lead sensitive data encryption", () => {
  const context = { organizationId: "10000000-0000-4000-8000-000000000001", centreId: "20000000-0000-4000-8000-000000000001", recordId: "30000000-0000-4000-8000-000000000001" };
  function configure(id = "lead-test") {
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = id;
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ [id]: Buffer.alloc(32, 31).toString("base64") });
    process.env.RUDRA_BLIND_INDEX_KEY = Buffer.alloc(32, 32).toString("base64");
  }

  it("encrypts lead identity and CRM details with authenticated record context", () => {
    configure();
    const input = { firstName: "Synthetic", lastName: "Lead", phone: "+919876543210", email: "TEST@example.invalid", interestedService: "Synthetic panel", campaign: "Synthetic campaign", contactEvidenceReference: null, marketingEvidenceReference: null, lostReason: null };
    const encrypted = encryptLeadPrivateData(input, context);
    expect(encrypted).not.toContain("Synthetic");
    expect(decryptLeadPrivateData(encrypted, context)).toEqual(input);
    expect(() => decryptLeadPrivateData(encrypted, { ...context, recordId: "30000000-0000-4000-8000-000000000002" })).toThrow("lead_data_integrity_failed");
  });

  it("normalizes phone/email blind indexes and keeps purposes separate", () => {
    configure();
    expect(blindIndexLeadContact("phone", "+91 98765 43210")).toBe(blindIndexLeadContact("phone", "+919876543210"));
    expect(blindIndexLeadContact("email", "TEST@example.invalid")).toBe(blindIndexLeadContact("email", "test@example.invalid"));
    expect(blindIndexLeadContact("phone", "test@example.invalid")).not.toBe(blindIndexLeadContact("email", "test@example.invalid"));
  });

  it("rejects tampering, wrong context and missing keys without plaintext fallback", () => {
    configure();
    const secret = encryptLeadValue("activity", { body: "Synthetic private note", metadata: { note: "Synthetic metadata" } }, context);
    const parts = secret.split("."); parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
    expect(() => decryptLeadValue("activity", parts.join("."), context)).toThrow("lead_data_integrity_failed");
    expect(() => decryptLeadValue("activity", secret, { ...context, centreId: "20000000-0000-4000-8000-000000000002" })).toThrow("lead_data_integrity_failed");
    delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    expect(() => encryptLeadValue("activity", "x", context)).toThrow("lead_encryption_key_unavailable");
  });

  it("encrypts communication drafts and rejects record-context swapping", () => {
    configure();
    const draft = encryptLeadValue("communication-draft", "Synthetic reminder only", context);
    expect(draft).not.toContain("Synthetic reminder");
    expect(decryptLeadValue("communication-draft", draft, context)).toBe("Synthetic reminder only");
    expect(() => decryptLeadValue("communication-draft", draft, { ...context, recordId: "30000000-0000-4000-8000-000000000002" })).toThrow("lead_data_integrity_failed");
  });
});
