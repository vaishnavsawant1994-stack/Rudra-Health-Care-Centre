import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { searchAuthorizedPatients } from "@/server/patient-search";

const searchSchema = z.object({ q: z.string().max(80).default(""), centreId: z.uuid().nullable().optional() });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = searchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_search" }, { status: 400 });
  const access = await getApiAccess("patients.read", parsed.data.centreId ?? undefined);
  if (access.response) return access.response;
  return searchAuthorizedPatients(access.staff, parsed.data.q, parsed.data.centreId ?? null);
}
