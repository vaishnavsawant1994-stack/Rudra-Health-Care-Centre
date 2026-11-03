import { describe, expect, it } from "vitest";
import { getAppointmentPublicLeadPrefill } from "@/lib/appointment-public-lead-prefill";

const itemId = "123e4567-e89b-42d3-a456-426614174000";

describe("appointment public lead prefill", () => {
  it("projects validated booking context without any address fields", () => {
    expect(getAppointmentPublicLeadPrefill([{ metadata: {
      source: "PUBLIC_ENQUIRY", requestKind: "BOOKING_REQUEST", requestedService: "Synthetic CBC",
      requestedCatalogueItemId: itemId, requestedCatalogueVersion: 4, preferredDate: "2027-01-20",
      preferredTimeWindow: "Morning", visitType: "HOME_COLLECTION", collectionAddress: { line1: "private address" },
    } }])).toEqual({
      serviceText: "Synthetic CBC", visitType: "HOME_COLLECTION", preferredDate: "2027-01-20",
      preferredTimeWindow: "Morning", catalogueItemId: itemId, catalogueVersion: 4,
    });
  });

  it("ignores unrelated activity and malformed request fields", () => {
    expect(getAppointmentPublicLeadPrefill([
      { metadata: { source: "CRM", requestKind: "BOOKING_REQUEST", visitType: "HOME_COLLECTION" } },
      { metadata: { source: "PUBLIC_ENQUIRY", requestKind: "BOOKING_REQUEST", visitType: "UNTRUSTED", preferredDate: "tomorrow", requestedCatalogueVersion: 0 } },
    ])).toEqual({ serviceText: "", visitType: null, preferredDate: null, preferredTimeWindow: null, catalogueItemId: null, catalogueVersion: null });
  });

  it("returns null when there is no public booking request", () => {
    expect(getAppointmentPublicLeadPrefill([{ metadata: { source: "PUBLIC_ENQUIRY", requestKind: "INQUIRY" } }])).toBeNull();
  });
});
