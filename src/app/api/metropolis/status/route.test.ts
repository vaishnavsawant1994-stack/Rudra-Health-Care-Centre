import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("manual Metropolis status API boundary", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("validates order scope and requires an authorized sample session", async () => {
    expect((await GET(new Request("http://localhost/api/metropolis/status?orderId=bad"))).status).toBe(400);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await GET(new Request("http://localhost/api/metropolis/status"))).status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("samples.read", undefined);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects provider-like states and malformed external evidence", async () => {
    const request = new Request("http://localhost/api/metropolis/status", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "972b2aed-30f9-4c01-9473-b8db9a6db88c" }, body: JSON.stringify({ action: "record", orderId: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5", statusCode: "PROVIDER_CONFIRMED", occurredAt: "2026-11-13T08:00:00.000Z", externalReference: "SYNTHETIC-EXT-1", evidenceReference: "SYNTHETIC-DOC-1", reason: "Synthetic test" }) });
    expect((await POST(request)).status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires a valid idempotency key for status writes", async () => {
    const request = new Request("http://localhost/api/metropolis/status", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ action: "record", orderId: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5", statusCode: "SAMPLE_RECEIVED", occurredAt: "2026-11-13T08:00:00.000Z", externalReference: "SYNTHETIC-EXT-1", evidenceReference: "SYNTHETIC-DOC-1", reason: "Synthetic test" }) });
    expect((await POST(request)).status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
  });
});
