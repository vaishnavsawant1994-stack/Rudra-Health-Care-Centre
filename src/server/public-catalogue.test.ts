import { describe, expect, it } from "vitest";
import { isPublicCatalogueVersionEligible } from "@/server/public-catalogue";

describe("public catalogue eligibility", () => {
  const verified = { active: true, publicVisible: true, verificationStatus: "VERIFIED", priceAmount: "125.00", effectiveFrom: "2026-10-01", effectiveUntil: "2026-10-31" };

  it("requires explicit publication, an active verified current price, and current effective dates", () => {
    expect(isPublicCatalogueVersionEligible(verified, "2026-10-30")).toBe(true);
    expect(isPublicCatalogueVersionEligible({ ...verified, publicVisible: false }, "2026-10-30")).toBe(false);
    expect(isPublicCatalogueVersionEligible({ ...verified, active: false }, "2026-10-30")).toBe(false);
    expect(isPublicCatalogueVersionEligible({ ...verified, verificationStatus: "UNVERIFIED" }, "2026-10-30")).toBe(false);
    expect(isPublicCatalogueVersionEligible({ ...verified, priceAmount: null }, "2026-10-30")).toBe(false);
    expect(isPublicCatalogueVersionEligible({ ...verified, effectiveFrom: "2026-10-31" }, "2026-10-30")).toBe(false);
    expect(isPublicCatalogueVersionEligible({ ...verified, effectiveUntil: "2026-10-29" }, "2026-10-30")).toBe(false);
  });

  it("keeps an open-ended verified price valid after its effective start", () => {
    expect(isPublicCatalogueVersionEligible({ ...verified, effectiveUntil: null }, "2027-01-01")).toBe(true);
  });
});
