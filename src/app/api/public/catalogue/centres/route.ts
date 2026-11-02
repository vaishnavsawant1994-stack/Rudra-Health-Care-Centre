import { listPublicCatalogueCentres } from "@/server/public-catalogue";

export async function GET() {
  try {
    return Response.json({ centres: await listPublicCatalogueCentres() });
  } catch {
    return Response.json({ error: "public_catalogue_unavailable" }, { status: 503 });
  }
}
