import { describe, expect, it } from "vitest";
import { getExactPublicBookingService, getPublicBookingCatalogueHref, getPublicBookingPrefill, getPublicBookingServiceText, getPublicCampaignAttribution } from "./public-booking-prefill";

describe("public booking prefill", () => {
  it("keeps only short, non-personal UTM labels for campaign attribution", () => {
    expect(getPublicCampaignAttribution("?utm_source=Google+Ads&utm_medium=CPC&utm_campaign=Diwali_2026&email=person%40example.test"))
      .toEqual({ source: "google-ads", medium: "cpc", campaign: "diwali_2026" });
    expect(getPublicCampaignAttribution("?utm_source=person%40example.test&utm_medium=direct-contact&utm_campaign=bad%2Fvalue"))
      .toEqual({ medium: "direct-contact" });
    expect(getPublicCampaignAttribution("?utm_term=health" )).toBeUndefined();
  });
  const centres = [{ id: "centre-a" }, { id: "centre-b" }];

  it("prefills a listed centre and editable service reference", () => {
    expect(getPublicBookingPrefill("?centreId=centre-b&service=Panel%20%28TEST-1%29", centres)).toEqual({
      centreId: "centre-b",
      requestedService: "Panel (TEST-1)",
      requestedCatalogueItemId: "",
      requestedCatalogueVersion: null,
      visitType: "CENTRE",
    });
  });

  it("ignores a centre that is not in the currently published centre list", () => {
    expect(getPublicBookingPrefill("?centreId=other&service=Test", centres)).toEqual({ centreId: "", requestedService: "Test", requestedCatalogueItemId: "", requestedCatalogueVersion: null, visitType: "CENTRE" });
  });

  it("trims and bounds the user-editable service text", () => {
    expect(getPublicBookingPrefill(`?service=%20${"x".repeat(170)}%20`, centres).requestedService).toBe("x".repeat(160));
  });

  it("prefills home collection only for the explicit supported value", () => {
    expect(getPublicBookingPrefill("?centreId=centre-a&visitType=HOME_COLLECTION", centres).visitType).toBe("HOME_COLLECTION");
    expect(getPublicBookingPrefill("?visitType=anything-else", centres).visitType).toBe("CENTRE");
  });

  it("accepts only a well-formed item id and positive catalogue version", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(getPublicBookingPrefill(`?centreId=centre-a&catalogueItemId=${id}&catalogueVersion=3`, centres)).toMatchObject({ requestedCatalogueItemId: id, requestedCatalogueVersion: 3 });
    expect(getPublicBookingPrefill(`?catalogueItemId=${id}&catalogueVersion=0`, centres)).toMatchObject({ requestedCatalogueItemId: "", requestedCatalogueVersion: null });
  });

  it("copies only a currently loaded public catalogue service into the request", () => {
    const services = [{ id: "service-a", displayName: "Synthetic CBC", serviceCode: "SYN-CBC" }];
    expect(getPublicBookingServiceText("service-a", services)).toBe("Synthetic CBC (SYN-CBC)");
    expect(getPublicBookingServiceText("unpublished-service", services)).toBeNull();
  });

  it("bounds the copied catalogue label to the public request field limit", () => {
    expect(getPublicBookingServiceText("service-a", [{ id: "service-a", displayName: "x".repeat(180), serviceCode: "SYN" }])).toHaveLength(160);
  });

  it("carries the exact catalogue item and version into the booking request", () => {
    const href = getPublicBookingCatalogueHref({ centreId: "centre-a", itemId: "item-a", version: 4, serviceText: "CBC (SYN-CBC)" });
    const url = new URL(href, "https://rudra.example");
    expect(url.pathname).toBe("/book");
    expect(url.searchParams.get("centreId")).toBe("centre-a");
    expect(url.searchParams.get("catalogueItemId")).toBe("item-a");
    expect(url.searchParams.get("catalogueVersion")).toBe("4");
    expect(url.searchParams.get("service")).toBe("CBC (SYN-CBC)");
  });

  it("accepts a deep link only for the exact current item version and centre", () => {
    const item = { id: "item-a", centreId: "centre-a", version: 2, displayName: "CBC", serviceCode: "CBC" };
    expect(getExactPublicBookingService({ item, requestedItemId: "item-a", requestedVersion: 2, centreId: "centre-a" })).toEqual(item);
    expect(getExactPublicBookingService({ item, requestedItemId: "item-a", requestedVersion: 1, centreId: "centre-a" })).toBeNull();
    expect(getExactPublicBookingService({ item, requestedItemId: "item-a", requestedVersion: 2, centreId: "centre-b" })).toBeNull();
  });
});
