export function publicCentreServiceRequestHref(centreId: string, service: { id: string; version: number; displayName: string; serviceCode: string }) {
  const params = new URLSearchParams({
    centreId,
    service: `${service.displayName} (${service.serviceCode})`.slice(0, 160),
    catalogueItemId: service.id,
    catalogueVersion: String(service.version),
  });
  return `/book?${params.toString()}`;
}
