import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { listPublicCatalogue, listPublicCatalogueCentres } from "@/server/public-catalogue";
import { publicSiteOrigin } from "@/server/public-site-origin";

const publicPaths = ["/", "/about", "/centres", "/service-areas", "/tests", "/packages", "/offers", "/home-collection", "/book", "/contact", "/corporate", "/doctors", "/partners", "/faq"];
const MAX_DYNAMIC_URLS = 49_900;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = publicSiteOrigin();
  if (!origin) return [];
  const entries: MetadataRoute.Sitemap = publicPaths.map((path) => ({ url: new URL(path, origin).toString() }));
  try {
    const centres = await listPublicCatalogueCentres();
    for (const centre of centres) {
      if (entries.length >= MAX_DYNAMIC_URLS) break;
      entries.push({ url: new URL(`/centres/${encodeURIComponent(centre.id)}`, origin).toString() });
    }
    let page = 1;
    while (entries.length < MAX_DYNAMIC_URLS) {
      const result = await listPublicCatalogue({ page, pageSize: 100 });
      for (const item of result.items) {
        if (entries.length >= MAX_DYNAMIC_URLS) break;
        entries.push({ url: new URL(`/${item.serviceType === "TEST" ? "tests" : "packages"}/${encodeURIComponent(item.id)}`, origin).toString() });
      }
      if (!result.hasMore || result.items.length === 0) break;
      page += 1;
    }
  } catch {
    // Public pages stay discoverable during a catalogue outage; no unverified
    // centre/service records are guessed or emitted into the sitemap.
  }
  return [...new Map(entries.map((entry) => [entry.url, entry])).values()];
}
