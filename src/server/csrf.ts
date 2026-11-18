export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const requestOrigin = new URL(request.url).origin;
  if (origin) {
    try { return new URL(origin).origin === requestOrigin; } catch { return false; }
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
