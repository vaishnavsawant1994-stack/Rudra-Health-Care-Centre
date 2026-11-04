import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectionSpecimenAttempt } from "./collection-specimen-attempt";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";

describe("collection specimen retry identity", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };

  beforeEach(() => {
    entries.clear();
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("crypto", {
      subtle: globalThis.crypto.subtle,
      randomUUID: vi.fn().mockReturnValueOnce("specimen-attempt-a").mockReturnValueOnce("specimen-attempt-b"),
    });
  });

  it("reuses the same job-scoped attempt across retries and page reloads without storing the request", async () => {
    const attempts = new Map<string, IdempotencyAttempt>();
    const request = JSON.stringify({ action: "collect", specimenType: "Synthetic tube", reason: "Synthetic note" });
    const first = collectionSpecimenAttempt("synthetic-job-a", attempts);
    const key = await first.attempt.keyFor(request);

    expect(collectionSpecimenAttempt("synthetic-job-a", attempts)).toEqual(first);
    expect(await first.attempt.keyFor(request)).toBe(key);
    expect([...entries.values()].join(" ")).not.toContain("Synthetic");

    const afterReload = collectionSpecimenAttempt("synthetic-job-a", new Map());
    expect(await afterReload.attempt.keyFor(request)).toBe(key);
    expect(collectionSpecimenAttempt("synthetic-job-b", attempts).attempt).not.toBe(first.attempt);
  });
});
