import { listPublicCentres } from "@/server/public-enquiry-centres";

export async function GET() {
  try {
    return Response.json({ centres: await listPublicCentres() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "public_centres_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
