export type DoctorProfileCentre = { id: string };

/** Resolve a profile only through centre IDs already returned by the authorized centres API. */
export async function loadDoctorProfileFromAuthorizedCentres<T>(
  doctorId: string,
  centres: readonly DoctorProfileCentre[],
  fetcher: typeof fetch = fetch,
): Promise<{ centreId: string; profile: T } | null> {
  for (const centre of centres) {
    const response = await fetcher(`/api/doctors/${encodeURIComponent(doctorId)}?centreId=${encodeURIComponent(centre.id)}`, { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as T;
      if (body && typeof body === "object" && "doctor" in body) return { centreId: centre.id, profile: body };
      throw new Error("doctor_profile_response_invalid");
    }
    if (response.status !== 403 && response.status !== 404) throw new Error("doctor_profile_unavailable");
  }
  return null;
}
