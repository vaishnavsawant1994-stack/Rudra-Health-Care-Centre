import { describe, expect, it } from "vitest";
import { buildInternalQuoteTotal, cataloguePriceToPaise, leadQuoteCreateSchema, localDateForTimeZone, quoteSelectionHasOverlap, quoteableVerifiedPrice } from "./lead-quote-policy";

describe("internal lead quote policy", () => {
  it("converts catalogue decimal strings to integer paise without floating-point arithmetic", () => {
    expect(cataloguePriceToPaise("125.05")).toBe(12_505);
    expect(cataloguePriceToPaise("0")).toBe(0);
    expect(() => cataloguePriceToPaise("12.345")).toThrow("catalogue_price_invalid");
  });
  it("only accepts verified, sourced, effective INR prices", () => {
    const price = { verificationStatus: "VERIFIED", priceAmount: "500.00", priceSourceReference: "approved synthetic source", effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31", currency: "INR" };
    expect(quoteableVerifiedPrice(price, "2026-11-03")).toBe(true);
    expect(quoteableVerifiedPrice({ ...price, verificationStatus: "UNVERIFIED" }, "2026-11-03")).toBe(false);
    expect(quoteableVerifiedPrice({ ...price, currency: "USD" }, "2026-11-03")).toBe(false);
    expect(quoteableVerifiedPrice({ ...price, effectiveUntil: "2026-10-31" }, "2026-11-03")).toBe(false);
  });
  it("uses the centre timezone for the price effective date", () => {
    const instant = new Date("2026-11-02T19:00:00.000Z");
    expect(localDateForTimeZone(instant, "Asia/Kolkata")).toBe("2026-11-03");
    expect(localDateForTimeZone(instant, "UTC")).toBe("2026-11-02");
    expect(() => localDateForTimeZone(instant, "Not/A_Timezone")).toThrow("quote_timezone_invalid");
  });
  it("keeps diagnostic prices separate from approved fee choices and requires a waiver reason", () => {
    expect(buildInternalQuoteTotal([12_500, 7_050], 9_900)).toEqual({ diagnosticTotalPaise: 19_550, homeVisitFeePaise: 9_900, totalPaise: 29_450 });
    expect(leadQuoteCreateSchema.safeParse({ catalogueVersionIds: ["3b13ac1a-3b17-4f9e-b997-b70d7c6ca4e3"], visitType: "CENTRE", homeVisitFeePaise: 0 }).success).toBe(true);
    expect(leadQuoteCreateSchema.safeParse({ catalogueVersionIds: ["3b13ac1a-3b17-4f9e-b997-b70d7c6ca4e3"], visitType: "HOME_COLLECTION", homeVisitFeePaise: 0 }).success).toBe(false);
    expect(leadQuoteCreateSchema.safeParse({ catalogueVersionIds: ["3b13ac1a-3b17-4f9e-b997-b70d7c6ca4e3"], visitType: "HOME_COLLECTION", homeVisitFeePaise: 0, homeVisitFeeReason: "Synthetic waived fee" }).success).toBe(true);
    expect(leadQuoteCreateSchema.safeParse({ catalogueVersionIds: ["3b13ac1a-3b17-4f9e-b997-b70d7c6ca4e3"], visitType: "CENTRE", homeVisitFeePaise: 7_500 }).success).toBe(false);
    expect(() => buildInternalQuoteTotal([12_500], 1)).toThrow("quote_amount_invalid");
  });
  it("rejects overlapping package components in the selected quote", () => {
    expect(quoteSelectionHasOverlap([{ serviceType: "PACKAGE", serviceCode: "P1", components: ["T1", "T2"] }, { serviceType: "TEST", serviceCode: "T1", components: [] }])).toBe(true);
    expect(quoteSelectionHasOverlap([{ serviceType: "PACKAGE", serviceCode: "P1", components: ["T1"] }, { serviceType: "TEST", serviceCode: "T2", components: [] }])).toBe(false);
  });
});
