const storageKey = "rudra-public-booking-enquiry-attempt";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stores only an opaque attempt UUID so an uncertain POST can be safely replayed after reload. */
export function getPublicBookingIdempotencyKey() {
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing && uuidPattern.test(existing)) return existing;
    const created = window.crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return window.crypto.randomUUID();
  }
}

export function clearPublicBookingIdempotencyKey() {
  try { window.sessionStorage.removeItem(storageKey); } catch { /* Storage can be disabled; no request data is stored. */ }
}
