import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdempotencyAttempt } from "./idempotency-attempt";

describe("IdempotencyAttempt", () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  beforeEach(() => { entries.clear(); vi.stubGlobal("sessionStorage", storage); vi.stubGlobal("crypto", { subtle: globalThis.crypto.subtle, randomUUID: vi.fn().mockReturnValueOnce("request-a").mockReturnValueOnce("request-b").mockReturnValueOnce("request-c").mockReturnValueOnce("request-d") }); });

  it("reuses a key for the same payload after an uncertain response", async () => {
    const attempt = new IdempotencyAttempt();
    expect(await attempt.keyFor('{"task":"synthetic"}')).toBe("request-a");
    expect(await attempt.keyFor('{"task":"synthetic"}')).toBe("request-a");
  });

  it("uses a new key when the payload changes or a prior request completes", async () => {
    const attempt = new IdempotencyAttempt();
    expect(await attempt.keyFor('{"task":"first"}')).toBe("request-a");
    expect(await attempt.keyFor('{"task":"changed"}')).toBe("request-b");
    attempt.clear();
    expect(await attempt.keyFor('{"task":"changed"}')).toBe("request-c");
  });

  it("restores only the key and digest after a reload for the same payload", async () => {
    const firstPage = new IdempotencyAttempt("test:roster-action");
    expect(await firstPage.keyFor('{"action":"update","note":"synthetic"}')).toBe("request-a");
    expect([...entries.values()][0]).not.toContain('"note"');
    const reloadedPage = new IdempotencyAttempt("test:roster-action");
    expect(await reloadedPage.keyFor('{"action":"update","note":"synthetic"}')).toBe("request-a");
    expect(await reloadedPage.keyFor('{"action":"cancel"}')).toBe("request-b");
    reloadedPage.clear();
    expect(entries.size).toBe(0);
  });

  it("shares an arrival retry across views for one appointment but isolates other appointments", async () => {
    const queueView = new IdempotencyAttempt("rudra:appointment-arrival:appointment-a");
    const detailView = new IdempotencyAttempt("rudra:appointment-arrival:appointment-a");
    const otherAppointment = new IdempotencyAttempt("rudra:appointment-arrival:appointment-b");
    const arrival = '{"arrivalConfirmed":true}';

    const queueKey = await queueView.keyFor(arrival);
    expect(await detailView.keyFor(arrival)).toBe(queueKey);
    expect(await otherAppointment.keyFor(arrival)).not.toBe(queueKey);
  });
});
