import { describe, expect, it, vi } from "vitest";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";
import { submitCollectionJob } from "./collection-job-create";

const payload = { appointmentId: "appointment-synthetic", orderId: "order-synthetic" };
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("collection job creation retries", () => {
  it("reuses the idempotency key after an uncertain network failure", async () => {
    const attempt = new IdempotencyAttempt();
    const keys: string[] = [];
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => { keys.push(new Headers(init?.headers).get("idempotency-key") ?? ""); throw new Error("connection lost"); })
      .mockImplementationOnce(async (_url, init) => { keys.push(new Headers(init?.headers).get("idempotency-key") ?? ""); return response(200, { job: { id: "job-synthetic", replayed: true } }); });

    expect(await submitCollectionJob(payload, attempt, fetcher)).toEqual({ kind: "unconfirmed" });
    expect(await submitCollectionJob(payload, attempt, fetcher)).toEqual({ kind: "saved", body: { job: { id: "job-synthetic", replayed: true } }, replayed: true });
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("clears a rejected request key so corrected input can be submitted", async () => {
    const attempt = new IdempotencyAttempt();
    const keys: string[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      return response(409, { error: "order_not_confirmed" });
    });
    const result = await submitCollectionJob(payload, attempt, fetcher);
    expect(result).toMatchObject({ kind: "rejected", status: 409, body: { error: "order_not_confirmed" } });
    await submitCollectionJob(payload, attempt, fetcher);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("retains the key after a server error and clears it after success", async () => {
    const attempt = new IdempotencyAttempt();
    const keys: string[] = [];
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => { keys.push(new Headers(init?.headers).get("idempotency-key") ?? ""); return response(503, {}); })
      .mockImplementationOnce(async (_url, init) => { keys.push(new Headers(init?.headers).get("idempotency-key") ?? ""); return response(201, { job: { id: "job-synthetic", jobNumber: "RHC-C-SYNTHETIC" } }); });

    expect((await submitCollectionJob(payload, attempt, fetcher)).kind).toBe("rejected");
    expect((await submitCollectionJob(payload, attempt, fetcher)).kind).toBe("saved");
    expect(keys[0]).toBe(keys[1]);
  });
});
