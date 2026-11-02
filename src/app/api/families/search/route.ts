import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { searchAuthorizedFamilies } from "@/server/family-search";

const schema = z.object({ q: z.string().max(80).default(""), centreId: z.uuid().nullable().optional() });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_search" }, { status: 400 });
  const centreId = parsed.data.centreId ?? null;
  const familyAccess = await getApiAccess("families.read", centreId ?? undefined);
  if (familyAccess.response) return familyAccess.response;
  const patientAccess = await getApiAccess("patients.read", centreId ?? undefined);
  if (patientAccess.response) return patientAccess.response;
  return searchAuthorizedFamilies(familyAccess.staff, parsed.data.q, centreId);
}
