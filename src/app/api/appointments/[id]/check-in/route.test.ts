import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

import { POST } from "./route";

describe("appointment front-desk check-in API boundary", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("rejects cross-origin actions before auth or database access", async () => {
    const response = await POST(new Request("http://localhost/api/appointments/00000000-0000-4000-8000-000000000001/check-in", { method: "POST", headers: { origin: "https://untrusted.invalid", "content-type": "application/json" }, body: JSON.stringify({ arrivalConfirmed: true }) }), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
    expect(response.status).toBe(403);
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects signed-out or incomplete-MFA sessions before reading appointment data", async () => {
    for (const status of [401, 428]) {
      getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "denied" }, { status }) });
      const response = await POST(new Request("http://localhost/api/appointments/00000000-0000-4000-8000-000000000001/check-in", { method: "POST", headers: { origin: "http://localhost", "idempotency-key": "00000000-0000-4000-8000-000000000002", "content-type": "application/json" }, body: JSON.stringify({ arrivalConfirmed: true }) }), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
      expect(response.status).toBe(status);
    }
    expect(getDb).not.toHaveBeenCalled();
  });
});
