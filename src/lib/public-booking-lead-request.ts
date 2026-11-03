const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicBookingLeadRequest = {
  service: string | null;
  catalogueItemId: string | null;
  catalogueVersion: number | null;
  preferredDate: string | null;
  preferredTimeWindow: string | null;
  visitType: "CENTRE" | "HOME_COLLECTION" | null;
};

/** Projects only the non-address scheduling fields from an encrypted public request activity. */
export function getPublicBookingLeadRequest(metadata: Record<string, unknown>): PublicBookingLeadRequest | null {
  if (metadata.source !== "PUBLIC_ENQUIRY" || metadata.requestKind !== "BOOKING_REQUEST") return null;
  const version = metadata.requestedCatalogueVersion;
  const preferredDate = metadata.preferredDate;
  const timeWindow = metadata.preferredTimeWindow;
  const visitType = metadata.visitType;
  return {
    service: typeof metadata.requestedService === "string" && metadata.requestedService.trim() ? metadata.requestedService.trim().slice(0, 160) : null,
    catalogueItemId: typeof metadata.requestedCatalogueItemId === "string" && uuidPattern.test(metadata.requestedCatalogueItemId) ? metadata.requestedCatalogueItemId : null,
    catalogueVersion: typeof version === "number" && Number.isSafeInteger(version) && version > 0 ? version : null,
    preferredDate: typeof preferredDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ? preferredDate : null,
    preferredTimeWindow: typeof timeWindow === "string" && timeWindow.trim() ? timeWindow.trim().slice(0, 120) : null,
    visitType: visitType === "CENTRE" || visitType === "HOME_COLLECTION" ? visitType : null,
  };
}
