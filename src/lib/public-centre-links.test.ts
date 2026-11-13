import { describe, expect, it } from "vitest";
import { publicCentreDirectionsHref, publicCentreServiceRequestHref } from "./public-centre-links";
import { getPublicBookingPrefill } from "./public-booking-prefill";

describe("public centre service links", () => {
  it("creates directions only from a published public address", () => {
    expect(publicCentreDirectionsHref(null)).toBeNull();
    expect(publicCentreDirectionsHref("  ")).toBeNull();
    const href = publicCentreDirectionsHref("1 Synthetic Road, Sample City");
    expect(href).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
    expect(new URL(href!).searchParams.get("destination")).toBe("1 Synthetic Road, Sample City");
  });

  it("prefills a listed centre and editable service request without claiming an appointment", () => {
    const href = publicCentreServiceRequestHref("centre-a", { id: "123e4567-e89b-42d3-a456-426614174000", version: 4, displayName: "Synthetic CBC", serviceCode: "SYN-CBC" });
    const prefill = getPublicBookingPrefill(href.slice(href.indexOf("?")), [{ id: "centre-a" }]);
    expect(prefill).toEqual({ centreId: "centre-a", requestedService: "Synthetic CBC (SYN-CBC)", requestedCatalogueItemId: "123e4567-e89b-42d3-a456-426614174000", requestedCatalogueVersion: 4, visitType: "CENTRE" });
  });

  it("bounds the service label to the public request field length", () => {
    const href = publicCentreServiceRequestHref("centre-a", { id: "123e4567-e89b-42d3-a456-426614174000", version: 1, displayName: "x".repeat(200), serviceCode: "SYN" });
    expect(new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("service")).toHaveLength(160);
  });
});
