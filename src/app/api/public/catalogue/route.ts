import { z } from "zod";
import { listPublicCatalogue } from "@/server/public-catalogue";

const querySchema = z.object({ centreId: z.uuid().optional(), serviceType: z.enum(["TEST", "PACKAGE"]).optional(), q: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).max(2000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).strict();

export async function GET(request: Request) {
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  try {
    const result = await listPublicCatalogue({ centreId: query.data.centreId, serviceType: query.data.serviceType, query: query.data.q, page: query.data.page, pageSize: query.data.pageSize });
    return Response.json(result);
  } catch {
    return Response.json({ error: "public_catalogue_unavailable" }, { status: 503 });
  }
}
