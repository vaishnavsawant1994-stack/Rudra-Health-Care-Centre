import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess } = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));

import { POST } from "./route";

describe("collection job API boundary", () => {
  beforeEach(() => getApiAccess.mockReset());
  const payload = { appointmentId: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5", orderId: "a8bad75c-b226-46d8-b238-86501998dd41" };
  const req = (origin = "http://localhost") => new Request("http://localhost/api/collections", { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": "972b2aed-30f9-4c01-9473-b8db9a6db88c" }, body: JSON.stringify(payload) });
  it("rejects missing authentication and MFA before database access", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await POST(req())).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    expect((await POST(req())).status).toBe(428);
  });
  it("rejects cross-origin creation before authorization or persistence", async () => {
    expect((await POST(req("https://attacker.invalid"))).status).toBe(403);
    expect(getApiAccess).not.toHaveBeenCalled();
  });
});
