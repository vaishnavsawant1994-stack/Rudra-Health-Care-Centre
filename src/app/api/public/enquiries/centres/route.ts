import { listPublicEnquiryCentres } from "@/server/public-enquiry-centres";

export async function GET() {
  try {
    return Response.json({ centres: await listPublicEnquiryCentres() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "public_enquiry_centres_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
