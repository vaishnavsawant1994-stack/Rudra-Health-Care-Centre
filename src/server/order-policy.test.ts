import { describe, expect, it } from "vitest";
import { effectiveVerifiedPrice, hasOverlappingServices, orderCreateSchema, orderUpdateSchema } from "./order-policy";

const centreId = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";
const patientId = "0b191525-1f83-4490-9f46-578a217cafb0";
const versionId = "f06a9df7-3568-40f1-8977-ae85c19190c6";

describe("diagnostic order intake policy", () => {
  it("requires a patient or appointment and at least one catalogue version", () => {
    expect(orderCreateSchema.safeParse({ centreId, patientId, catalogueVersionIds: [versionId] }).success).toBe(true);
    expect(orderCreateSchema.safeParse({ centreId, catalogueVersionIds: [versionId] }).success).toBe(false);
    expect(orderCreateSchema.safeParse({ centreId, patientId, catalogueVersionIds: [] }).success).toBe(false);
  });
  it("only recognizes source-backed prices in their effective period", () => {
    const price = { verificationStatus: "VERIFIED", priceAmount: "500.00", priceSourceReference: "verified source", effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31" };
    expect(effectiveVerifiedPrice(price, "2026-10-01")).toBe(true);
    expect(effectiveVerifiedPrice(price, "2027-01-01")).toBe(false);
    expect(effectiveVerifiedPrice({ ...price, verificationStatus: "UNVERIFIED" }, "2026-10-01")).toBe(false);
  });
  it("detects individual and package overlap while allowing disjoint selections", () => {
    expect(hasOverlappingServices([{ serviceType: "PACKAGE", serviceCode: "P1", components: ["T1", "T2"] }, { serviceType: "TEST", serviceCode: "T1" }])).toBe(true);
    expect(hasOverlappingServices([{ serviceType: "PACKAGE", serviceCode: "P1", components: ["T1"] }, { serviceType: "PACKAGE", serviceCode: "P2", components: ["T2"] }])).toBe(false);
  });
  it("requires optimistic versions and cancellation reasons", () => {
    expect(orderUpdateSchema.safeParse({ action: "confirm", expectedVersion: 1 }).success).toBe(true);
    expect(orderUpdateSchema.safeParse({ action: "cancel", expectedVersion: 1, reason: "No longer required" }).success).toBe(true);
    expect(orderUpdateSchema.safeParse({ action: "cancel", expectedVersion: 1, reason: "" }).success).toBe(false);
  });
});
