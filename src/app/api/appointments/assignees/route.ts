import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { listAssignableAppointmentStaff } from "@/server/appointment-access";

export async function GET(request: Request) {
  const centreId = new URL(request.url).searchParams.get("centreId");
  if (!z.uuid().safeParse(centreId).success) return Response.json({ error: "centre_required" }, { status: 400 });
  const access = await getApiAccess("appointments.assign", centreId!);
  if (access.response) return access.response;
  return Response.json({ staff: await listAssignableAppointmentStaff(access.staff.organizationId, centreId!) });
}
