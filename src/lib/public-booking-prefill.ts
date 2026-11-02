export type PublicBookingCentre = { id: string };
export type PublicBookingService = { id: string; centreId?: string; version?: number; displayName: string; serviceCode: string };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Prefills only non-sensitive, user-editable booking context from a public link. */
export function getPublicBookingPrefill(search: string, centres: readonly PublicBookingCentre[]) {
  const params = new URLSearchParams(search);
  const requestedCentreId = params.get("centreId") ?? "";
  const centreId = centres.some((centre) => centre.id === requestedCentreId) ? requestedCentreId : "";
  const requestedService = (params.get("service") ?? "").trim().slice(0, 160);
  const requestedCatalogueItemId = params.get("catalogueItemId") ?? "";
  const parsedVersion = Number(params.get("catalogueVersion"));
  const requestedCatalogueVersion = UUID_PATTERN.test(requestedCatalogueItemId) && Number.isSafeInteger(parsedVersion) && parsedVersion > 0
    ? parsedVersion
    : null;
  const requestedVisitType = params.get("visitType");
  const visitType = requestedVisitType === "HOME_COLLECTION" ? "HOME_COLLECTION" : "CENTRE";
  return { centreId, requestedService, requestedCatalogueItemId: requestedCatalogueVersion === null ? "" : requestedCatalogueItemId, requestedCatalogueVersion, visitType };
}

/** Copies only a service present in the currently loaded public catalogue into the editable request text. */
export function getPublicBookingServiceText(serviceId: string, services: readonly PublicBookingService[]) {
  const service = services.find((item) => item.id === serviceId);
  return service ? `${service.displayName} (${service.serviceCode})`.slice(0, 160) : null;
}

/** Builds a booking link tied to the exact public catalogue version the visitor reviewed. */
export function getPublicBookingCatalogueHref(input: {
  centreId: string;
  itemId: string;
  version: number;
  serviceText: string;
}) {
  const params = new URLSearchParams({
    centreId: input.centreId,
    catalogueItemId: input.itemId,
    catalogueVersion: String(input.version),
    service: input.serviceText.slice(0, 160),
  });
  return `/book?${params.toString()}`;
}

/** Accepts a deep-linked catalogue item only when its current published version and centre match. */
export function getExactPublicBookingService<T extends PublicBookingService>(input: {
  item: T;
  requestedItemId: string;
  requestedVersion: number | null;
  centreId: string;
}): T | null {
  return input.requestedVersion !== null
    && input.item.id === input.requestedItemId
    && input.item.version === input.requestedVersion
    && input.item.centreId === input.centreId
    ? input.item
    : null;
}
