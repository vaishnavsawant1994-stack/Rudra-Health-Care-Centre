import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "./operational-crypto";

const key = randomBytes(32).toString("base64");
const context = { organizationId: randomUUID(), centreId: randomUUID(), recordId: randomUUID() };
const ctx = operationalContext(context, "sample-custody-event");
const original = { reason: "synthetic collection note", evidenceReference: "SYNTH-REF-1" };

afterEach(() => { delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; });
function configure(value = key) { process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ test_key: value }); process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "test_key"; }

describe("operational private-data encryption", () => {
  it("round-trips protected values with authenticated context", () => { configure(); expect(decryptOperationalData(encryptOperationalData(original, ctx), ctx)).toEqual(original); });
  it("uses a different nonce for each encryption", () => { configure(); expect(encryptOperationalData(original, ctx)).not.toBe(encryptOperationalData(original, ctx)); });
  it("rejects a different record context", () => { configure(); const value = encryptOperationalData(original, ctx); expect(() => decryptOperationalData(value, operationalContext({ ...context, recordId: randomUUID() }, "sample-custody-event"))).toThrow("operational_data_integrity_failed"); });
  it("rejects a different field/entity type context", () => { configure(); const value = encryptOperationalData(original, ctx); expect(() => decryptOperationalData(value, operationalContext(context, "specimen"))).toThrow("operational_data_integrity_failed"); });
  it("rejects ciphertext tampering", () => { configure(); const value = encryptOperationalData(original, ctx); const changed = `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`; expect(() => decryptOperationalData(changed, ctx)).toThrow("operational_data_integrity_failed"); });
  it("fails closed when the key is unavailable", () => { configure(); const value = encryptOperationalData(original, ctx); process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ other_key: key }); expect(() => decryptOperationalData(value, ctx)).toThrow("operational_encryption_key_unavailable"); });
  it("fails closed when configuration is missing", () => { expect(() => encryptOperationalData(original, ctx)).toThrow("operational_encryption_key_unavailable"); });
  it("uses keyed request fingerprints and verifies retained keys after rotation", () => {
    configure();
    const request = { address: "synthetic private address", reason: "synthetic private reason" };
    const requestContext = operationalContext(context, "appointment-create-idempotency");
    const fingerprint = fingerprintOperationalRequest(request, requestContext);
    expect(fingerprint).not.toBe(createHash("sha256").update(JSON.stringify(request)).digest("hex"));
    expect(verifyOperationalRequestFingerprint(request, fingerprint, requestContext)).toBe(true);
    expect(verifyOperationalRequestFingerprint({ ...request, reason: "different reason" }, fingerprint, requestContext)).toBe(false);
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ test_key: key, rotated_key: randomBytes(32).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "rotated_key";
    expect(verifyOperationalRequestFingerprint(request, fingerprint, requestContext)).toBe(true);
  });
});
