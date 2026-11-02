import { describe, expect, it } from "vitest";
import { escalationRequestFingerprint, legacyEscalationRequestFingerprint, sameEscalationPrivateRequest } from "./escalation-request-fingerprint";

const request = { centreId: "centre-1", source: { type: "REPORT", id: "record-1" }, title: "Synthetic issue", description: "Synthetic private details", severity: "HIGH", priority: "NORMAL", assignedOwnerStaffId: "staff-1", dueAt: "2026-11-05T12:00:00.000Z", deduplicateOpenSource: false };

describe("escalation idempotency fingerprints", () => {
  it("does not include encrypted title or description in the database request hash", () => {
    expect(escalationRequestFingerprint(request)).toBe(escalationRequestFingerprint({ ...request, title: "Different synthetic text", description: "Another private detail" }));
    expect(legacyEscalationRequestFingerprint(request)).not.toBe(escalationRequestFingerprint(request));
  });

  it("still distinguishes private values after authorized decryption", () => {
    expect(sameEscalationPrivateRequest({ title: request.title, description: request.description }, request)).toBe(true);
    expect(sameEscalationPrivateRequest({ title: request.title, description: "Changed" }, request)).toBe(false);
    expect(sameEscalationPrivateRequest(null, request)).toBe(false);
  });
});
