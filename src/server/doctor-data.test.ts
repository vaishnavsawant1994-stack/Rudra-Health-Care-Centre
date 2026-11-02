import { afterEach, describe, expect, it } from "vitest";
import { openDoctorData, openDoctorEvent, sealDoctorData, sealDoctorEvent } from "./doctor-data";

const saved = { keys: process.env.RUDRA_FIELD_ENCRYPTION_KEYS, id: process.env.RUDRA_FIELD_ACTIVE_KEY_ID };
const scope = { organizationId: "10000000-0000-4000-8000-000000000001", centreId: "20000000-0000-4000-8000-000000000001", id: "30000000-0000-4000-8000-000000000001" };
afterEach(() => { if (saved.keys === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = saved.keys; if (saved.id === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = saved.id; });
function configure() { process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "doctor-test"; process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ "doctor-test": Buffer.alloc(32, 47).toString("base64") }); }

describe("doctor relationship data protection", () => {
  it("encrypts contact/profile details and binds them to the authorized record context", () => {
    configure(); const value = { name: "Synthetic Doctor", phone: "+919876543210", email: "doctor@example.invalid", registrationReference: "SYNTH-REG-01", affiliation: "Synthetic clinic", notes: "Synthetic note" };
    const encrypted = sealDoctorData(scope, value); expect(encrypted).not.toContain("Synthetic"); expect(openDoctorData(scope, encrypted)).toEqual(value);
    expect(() => openDoctorData({ ...scope, centreId: "20000000-0000-4000-8000-000000000002" }, encrypted)).toThrow("operational_data_integrity_failed");
    const parts = encrypted.split("."); parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
    expect(() => openDoctorData(scope, parts.join("."))).toThrow("operational_data_integrity_failed");
  });
  it("uses a distinct authenticated event context and fails closed without keys", () => {
    configure(); const event = sealDoctorEvent(scope, { category: "TEST_ENQUIRY", note: "Synthetic referral" }); expect(event).not.toContain("Synthetic referral"); expect(openDoctorEvent(scope, event)).toEqual({ category: "TEST_ENQUIRY", note: "Synthetic referral" });
    expect(() => openDoctorEvent({ ...scope, id: "30000000-0000-4000-8000-000000000002" }, event)).toThrow("operational_data_integrity_failed");
    delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    expect(() => sealDoctorData(scope, { name: "x", phone: null, email: null, registrationReference: null, affiliation: null, notes: null })).toThrow("operational_encryption_key_unavailable");
  });
});
