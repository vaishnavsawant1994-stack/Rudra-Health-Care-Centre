import { describe, expect, it } from "vitest";
import { computeAuditEventHash, GENESIS_AUDIT_HASH, verifyAuditChain } from "./audit-format.mjs";

describe("append-only audit chain integrity", () => {
  it("verifies canonical hashes and detects altered event data", () => {
    const first = { id: "event-1", organizationId: "org-1", centreId: null, actorStaffId: "staff-1", action: "staff.created", entityType: "staff", entityId: "staff-1", details: { status: "INVITED" }, recordedAt: new Date("2026-01-01T00:00:00.000Z") };
    const firstHash = computeAuditEventHash(first, GENESIS_AUDIT_HASH);
    const second = { ...first, id: "event-2", action: "staff.updated" };
    const secondHash = computeAuditEventHash(second, firstHash);
    const chain = [{ ...first, previousHash: GENESIS_AUDIT_HASH, eventHash: firstHash }, { ...second, previousHash: firstHash, eventHash: secondHash }];
    expect(verifyAuditChain(chain).valid).toBe(true);
    expect(verifyAuditChain([{ ...chain[0], details: { status: "ACTIVE" } }, chain[1]]).valid).toBe(false);
  });
});
