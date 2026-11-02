type Attempt = { key: string; digest: string };

/** Keeps retries of the same request on one idempotency key without retaining its body. */
export class IdempotencyAttempt {
  private attempt: Attempt | null = null;

  constructor(private readonly storageKey?: string) {}

  private restore() {
    if (!this.storageKey || typeof sessionStorage === "undefined") return null;
    try {
      const stored = sessionStorage.getItem(this.storageKey);
      if (!stored) return null;
      const value: unknown = JSON.parse(stored);
      if (!value || typeof value !== "object" || !("key" in value) || !("digest" in value) || typeof value.key !== "string" || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)) return null;
      return { key: value.key, digest: value.digest };
    } catch { return null; }
  }

  private persist() {
    if (!this.storageKey || typeof sessionStorage === "undefined" || !this.attempt) return;
    try { sessionStorage.setItem(this.storageKey, JSON.stringify(this.attempt)); } catch { /* Browser storage can be unavailable; in-memory retries still work. */ }
  }

  async keyFor(body: string): Promise<string> {
    const digestBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const digest = Array.from(new Uint8Array(digestBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!this.attempt) this.attempt = this.restore();
    if (!this.attempt || this.attempt.digest !== digest) { this.attempt = { key: crypto.randomUUID(), digest }; this.persist(); }
    return this.attempt.key;
  }

  clear() {
    this.attempt = null;
    if (this.storageKey && typeof sessionStorage !== "undefined") {
      try { sessionStorage.removeItem(this.storageKey); } catch { /* Best-effort cleanup; no request body is stored. */ }
    }
  }
}
