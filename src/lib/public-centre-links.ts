export function publicCentreServiceRequestHref(centreId: string, service: { id: string; version: number; displayName: string; serviceCode: string }) {
  const params = new URLSearchParams({
    centreId,
    service: `${service.displayName} (${service.serviceCode})`.slice(0, 160),
    catalogueItemId: service.id,
    catalogueVersion: String(service.version),
  });
  return `/book?${params.toString()}`;
}

/** Build a directions link only from an explicitly published centre address. */
export function publicCentreDirectionsHref(address: string | null | undefined) {
  const destination = address?.trim();
  if (!destination) return null;
  const params = new URLSearchParams({ api: "1", destination });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
