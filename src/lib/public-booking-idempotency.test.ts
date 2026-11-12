import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPublicBookingIdempotencyKey, getPublicBookingIdempotencyKey } from "@/lib/public-booking-idempotency";

describe("public booking idempotency key storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retains only an opaque UUID for retries across route reloads", () => {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem, removeItem: (key: string) => values.delete(key) }, crypto: { randomUUID: () => "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34" } });

    const first = getPublicBookingIdempotencyKey();
    const retry = getPublicBookingIdempotencyKey();
    expect(retry).toBe(first);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect([...values.values()]).toEqual([first]);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("clears the attempt after a confirmed response", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }, crypto: { randomUUID: () => "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34" } });
    getPublicBookingIdempotencyKey();
    clearPublicBookingIdempotencyKey();
    expect(values.size).toBe(0);
  });
});
