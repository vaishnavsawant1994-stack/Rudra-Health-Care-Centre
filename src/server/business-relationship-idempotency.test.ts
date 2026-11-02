import { describe, expect, it } from "vitest";
import { relationshipCreateFingerprint, sameRelationshipPrivateData } from "@/server/business-relationship-idempotency";

describe("business relationship idempotency", () => {
  it("keeps sensitive contact and agreement details out of request fingerprints", () => {
    const publicFields = { centreId: "synthetic-centre", type: "CORPORATE", category: "EMPLOYER" };
    expect(relationshipCreateFingerprint(publicFields)).toBe(relationshipCreateFingerprint(publicFields));
    const privateData = { name: "Synthetic Company", legalName: null, primaryContactName: "Synthetic Contact", primaryContactRole: null, phone: "+910000000000", email: "contact@synthetic.invalid", address: "Synthetic address", agreementReference: "SYNTH-REF", agreementStatus: "NOT_RECORDED" as const, notes: null };
    expect(sameRelationshipPrivateData(privateData, privateData)).toBe(true);
    expect(sameRelationshipPrivateData({ ...privateData, phone: "+910000000001" }, privateData)).toBe(false);
  });
});
