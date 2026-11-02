import { z } from "zod";
import { listPublicCatalogue } from "@/server/public-catalogue";

const requestSchema = z.object({ query: z.string().trim().min(2).max(80).refine((value) => !/[%_\\]/.test(value), "wildcard_search_not_supported"), page: z.number().int().min(1).max(2000).default(1) }).strict();

/** A deterministic, read-only service finder. It never persists the query. */
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_service_search" }, { status: 400, headers: { "cache-control": "no-store" } });
  try {
    const result = await listPublicCatalogue({ query: parsed.data.query, page: parsed.data.page, pageSize: 8 });
    return Response.json({ items: result.items.map(({ id, centreId, centreName, serviceType, displayName, priceAmount, currency }) => ({ id, centreId, centreName, serviceType, displayName, priceAmount, currency })), page: result.page, hasMore: result.hasMore }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "service_search_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
