export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const requestOrigin = new URL(request.url).origin;
  if (origin) {
    try {
      const originMatches = new URL(origin).origin === requestOrigin;
      if (!originMatches && process.env.CI === "true") {
        console.warn("csrf_origin_rejected", {
          requestOrigin,
          origin: new URL(origin).origin,
          host: request.headers.get("host"),
          forwardedHost: request.headers.get("x-forwarded-host"),
          forwardedProto: request.headers.get("x-forwarded-proto"),
        });
      }
      return originMatches;
    } catch { return false; }
  }
  // Chromium may omit Origin on a same-origin fetch. A browser cannot forge
  // Referer, so accept it only when its origin exactly matches the request.
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try { return new URL(referer).origin === requestOrigin; } catch { return false; }
}

export function csrfRejected() {
  return Response.json({ error: "same_origin_required" }, { status: 403 });
}
