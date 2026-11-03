/** Select a requested centre only when it is present in the authorized list. */
export function chooseAuthorizedCentre<T extends { id: string }>(centres: readonly T[], requestedCentreId: string | null | undefined) {
  if (requestedCentreId && centres.some((centre) => centre.id === requestedCentreId)) return requestedCentreId;
  return centres[0]?.id ?? "";
}

/** Preserve a centre filter only when it is explicitly in the authorized list. */
export function resolveAuthorizedCentreFilter<T extends { id: string }>(centres: readonly T[], requestedCentreId: string | null | undefined) {
  return requestedCentreId && centres.some((centre) => centre.id === requestedCentreId) ? requestedCentreId : "";
}

const appointmentStatuses = new Set(["REQUESTED", "CONFIRMED", "ASSIGNED", "RESCHEDULED", "CANCELLED", "NO_SHOW"]);

export function resolveAppointmentDeepLink<T extends { id: string }>(centres: readonly T[], requestedCentreId: string | null, requestedStatus: string | null, fixedStatus = "") {
  const status = fixedStatus || (requestedStatus && appointmentStatuses.has(requestedStatus) ? requestedStatus : "");
  const centreId = requestedCentreId ? chooseAuthorizedCentre(centres, requestedCentreId) : "";
  return { centreId, status };
}
