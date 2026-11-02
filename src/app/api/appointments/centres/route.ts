import { getApiAccess } from "@/server/access";
import { getAppointmentReadAccess, listAppointmentCentres } from "@/server/appointment-access";

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("purpose");
  const purpose = requested === "create" ? "appointments.create" : requested === "assign" ? "appointments.assign" : "appointments.read";
  if (purpose === "appointments.read") {
    const access = await getAppointmentReadAccess();
    if (access.response) return access.response;
    const centres = await listAppointmentCentres(access.staff!, access.assignedOnly ? "appointments.assigned.read" : "appointments.read");
    return Response.json({ centres });
  }
  const access = await getApiAccess(purpose);
  if (access.response) return access.response;
  const centres = await listAppointmentCentres(access.staff, purpose);
  return Response.json({ centres });
}
