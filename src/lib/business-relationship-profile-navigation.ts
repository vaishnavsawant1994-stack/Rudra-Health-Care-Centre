export type BusinessRelationshipProfileCentre = { id: string };

/** Resolve corporate/partner profiles only through centre IDs returned by the authorized centres API. */
export async function loadBusinessRelationshipProfileFromAuthorizedCentres<T>(
  relationshipId: string,
  type: "CORPORATE" | "PARTNER",
  centres: readonly BusinessRelationshipProfileCentre[],
  fetcher: typeof fetch = fetch,
): Promise<{ centreId: string; profile: T } | null> {
  for (const centre of centres) {
    const params = new URLSearchParams({ centreId: centre.id, type });
    const response = await fetcher(`/api/business-relationships/${encodeURIComponent(relationshipId)}?${params}`, { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as T;
      if (body && typeof body === "object" && "relationship" in body) return { centreId: centre.id, profile: body };
      throw new Error("business_relationship_profile_response_invalid");
    }
    if (response.status !== 403 && response.status !== 404) throw new Error("business_relationship_profile_unavailable");
  }
  return null;
}
