import { describe, expect, it } from "vitest";
import { getPublicBookingLeadRequest } from "./public-booking-lead-request";

describe("public booking lead request projection", () => {
  it("preserves a validated catalogue snapshot reference and requested schedule without exposing the address", () => {
    const itemId = "9c60f4ae-71ec-49e8-8c17-29c85a80866f";
    expect(getPublicBookingLeadRequest({
      source: "PUBLIC_ENQUIRY", requestKind: "BOOKING_REQUEST", requestedService: "  Synthetic CBC  ",
      requestedCatalogueItemId: itemId, requestedCatalogueVersion: 4, preferredDate: "2027-01-20",
      preferredTimeWindow: "Morning", visitType: "HOME_COLLECTION", collectionAddress: { line1: "Private address" },
    })).toEqual({ service: "Synthetic CBC", catalogueItemId: itemId, catalogueVersion: 4, preferredDate: "2027-01-20", preferredTimeWindow: "Morning", visitType: "HOME_COLLECTION" });
  });

  it("does not project non-booking events or malformed reference values", () => {
    expect(getPublicBookingLeadRequest({ source: "PUBLIC_ENQUIRY", requestKind: "INQUIRY" })).toBeNull();
    expect(getPublicBookingLeadRequest({ source: "PUBLIC_ENQUIRY", requestKind: "BOOKING_REQUEST", requestedCatalogueItemId: "not-a-uuid", requestedCatalogueVersion: 0, preferredDate: "tomorrow", visitType: "UNKNOWN" })).toEqual({ service: null, catalogueItemId: null, catalogueVersion: null, preferredDate: null, preferredTimeWindow: null, visitType: null });
  });
});
