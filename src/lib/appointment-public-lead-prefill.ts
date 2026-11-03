import { getPublicBookingLeadRequest } from "@/lib/public-booking-lead-request";

export type AppointmentPublicLeadPrefill = {
  serviceText: string;
  visitType: "CENTRE" | "HOME_COLLECTION" | null;
  preferredDate: string | null;
  preferredTimeWindow: string | null;
  catalogueItemId: string | null;
  catalogueVersion: number | null;
};

/** Projects only non-address request fields for staff review in the appointment form. */
export function getAppointmentPublicLeadPrefill(activity: Array<{ metadata: Record<string, unknown> }>): AppointmentPublicLeadPrefill | null {
  for (const entry of activity) {
    const request = getPublicBookingLeadRequest(entry.metadata);
    if (!request) continue;
    return {
      serviceText: request.service ?? "",
      visitType: request.visitType,
      preferredDate: request.preferredDate,
      preferredTimeWindow: request.preferredTimeWindow,
      catalogueItemId: request.catalogueItemId,
      catalogueVersion: request.catalogueVersion,
    };
  }
  return null;
}
