import { z } from "zod";
import { getPublicCatalogueItem } from "@/server/public-catalogue";

const idSchema = z.uuid();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "catalogue_item_not_found" }, { status: 404 });
  try {
    const item = await getPublicCatalogueItem(id);
    return item ? Response.json({ item }) : Response.json({ error: "catalogue_item_not_found" }, { status: 404 });
  } catch {
    return Response.json({ error: "public_catalogue_unavailable" }, { status: 503 });
  }
}
