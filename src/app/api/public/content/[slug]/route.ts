import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { openWebsiteContent, parsePublicContentSlug } from "@/server/website-content";

type PublishedPage = { id: string; organization_id: string; slug: string; published_ciphertext: string };
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await context.params;
  const slug = parsePublicContentSlug(rawSlug);
  if (!slug) return Response.json({ error: "page_not_found" }, { status: 404 });
  try {
    const result = await getDb().execute(sql`SELECT id, organization_id, slug, published_ciphertext FROM website_content_pages WHERE slug = ${slug} AND published_ciphertext IS NOT NULL ORDER BY created_at ASC LIMIT 2`);
    const published = (result as unknown as { rows?: PublishedPage[] }).rows ?? [];
    // Never choose an arbitrary tenant if a deployment has more than one Rudra organization.
    if (published.length !== 1) return Response.json({ error: "page_not_found" }, { status: 404 });
    const page = published[0];
    return Response.json({ slug: page.slug, content: openWebsiteContent(page.organization_id, page.id, page.published_ciphertext) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "website_content_unavailable" }, { status: 503 });
  }
}
