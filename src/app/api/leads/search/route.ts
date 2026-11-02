import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { leadSources, leadStatuses } from "@/server/lead-policy";
import { searchAuthorizedLeads } from "@/server/lead-directory";

const schema = z.object({ q: z.string().max(80).default(""), centreId: z.uuid().nullable().optional(), status: z.enum(leadStatuses).nullable().optional(), source: z.enum(leadSources).nullable().optional(), assignedStaffId: z.uuid().nullable().optional(), page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(50).default(25) });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  if (new URL(request.url).searchParams.has("q")) return Response.json({ error: "search_requires_post_body" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.q.trim().length === 1) return Response.json({ error: "invalid_search" }, { status: 400 });
  const centreId = parsed.data.centreId ?? undefined;
  const access = await getApiAccess("leads.read", centreId);
  if (access.response) return access.response;
  return searchAuthorizedLeads(access.staff, parsed.data);
}
