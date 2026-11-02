import type { MetadataRoute } from "next";
import { publicSiteOrigin } from "@/server/public-site-origin";

const privatePrefixes = [
  "/account", "/actions", "/appointments", "/branch", "/collections", "/escalations", "/families",
  "/field", "/finance", "/leads", "/orders", "/owner", "/patients", "/reports", "/relationships",
  "/roster", "/samples", "/staff", "/tasks", "/workspaces", "/api",
];

export default function robots(): MetadataRoute.Robots {
  const origin = publicSiteOrigin();
  return {
    rules: { userAgent: "*", allow: "/", disallow: privatePrefixes },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
