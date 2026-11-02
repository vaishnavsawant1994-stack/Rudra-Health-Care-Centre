/** Resolve the canonical public origin without accepting credentials or URL paths. */
export function publicSiteOrigin(environment: NodeJS.ProcessEnv = process.env): string | null {
  const configured = environment.PUBLIC_SITE_URL?.trim() || environment.NEXT_PUBLIC_SITE_URL?.trim();
  const source = configured || (environment.NODE_ENV === "production" ? "" : environment.BETTER_AUTH_URL?.trim());
  if (!source) return environment.NODE_ENV === "production" ? null : "http://localhost:3000";
  try {
    const url = new URL(source);
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (environment.NODE_ENV === "production" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
