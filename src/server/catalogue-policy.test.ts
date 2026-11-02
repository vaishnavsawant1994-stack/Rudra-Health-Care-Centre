import { describe, expect, it } from "vitest";
import { catalogueCreateSchema, cataloguePriceAuditDetails, csvParse, validateCatalogueCsv } from "./catalogue-policy";

describe("diagnostic catalogue import validation", () => {
  it("keeps reviewer evidence out of general audit metadata", () => {
    const details = cataloguePriceAuditDetails({ version: 2, decision: "VERIFIED", priceAmount: "125.00", reviewId: "review-id" });
    expect(details).toEqual({ version: 2, decision: "VERIFIED", priceAmount: "125.00", reviewId: "review-id" });
    expect(details).not.toHaveProperty("sourceReference");
    expect(details).not.toHaveProperty("reason");
    expect(details).not.toHaveProperty("sourceDigest");
    expect(details).not.toHaveProperty("reasonDigest");
  });
  it("parses quoted CSV cells, commas, and escaped quotes", () => {
    expect(csvParse('service_type,service_code,display_name\nTEST,A,"Blood, ""basic"" panel"').rows[0]).toEqual(["TEST", "A", 'Blood, "basic" panel']);
  });
  it("rejects duplicate rows and malformed or incomplete packages", () => {
    const duplicate = validateCatalogueCsv("service_type,service_code,display_name\nTEST,A,One\nTEST,A,Two");
    expect(duplicate.errors[0]?.code).toBe("duplicate_in_file");
    const packageWithoutTests = validateCatalogueCsv("service_type,service_code,display_name\nPACKAGE,P,Package");
    expect(packageWithoutTests.errors[0]?.code).toBe("invalid_row");
  });
  it("returns package component codes for later centre-scoped database validation", () => {
    const result = validateCatalogueCsv("service_type,service_code,display_name,components\nTEST,T1,Test one,\nPACKAGE,P1,Package one,T1");
    expect(result.errors).toEqual([]);
    expect(result.accepted[1].components).toBe("T1");
  });
  it("rejects unclosed quotes and oversized imports", () => {
    expect(() => csvParse('a,b\n"x,y')).toThrow(/unclosed/);
    expect(() => csvParse("x".repeat(1_000_001))).toThrow(/1 MB/);
  });
  it("allows synthetic catalogue references only without a price", () => {
    const base = { centreId: "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34", serviceType: "TEST", serviceCode: "SYNTH-1", displayName: "Synthetic test", recordKind: "SYNTHETIC_TEST" };
    expect(catalogueCreateSchema.safeParse(base).success).toBe(true);
    expect(catalogueCreateSchema.safeParse({ ...base, priceAmount: "1.00" }).success).toBe(false);
  });
});
