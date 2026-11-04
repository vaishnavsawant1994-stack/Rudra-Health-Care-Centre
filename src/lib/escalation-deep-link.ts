const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function escalationDeepLinkId(search: string) {
  const value = new URLSearchParams(search).get("escalationId");
  return value && UUID_PATTERN.test(value) ? value : null;
}

export function escalationDeepLinkHref(id: string, centreId?: string) {
  return `/escalations?${new URLSearchParams({ escalationId: id, ...(centreId ? { centreId } : {}) })}`;
}
