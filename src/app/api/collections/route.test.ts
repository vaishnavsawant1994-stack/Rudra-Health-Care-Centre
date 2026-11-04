import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess } = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));

import { PATCH } from "./[id]/route";
import { POST } from "./route";

describe("collection job API boundary", () => {
  beforeEach(() => getApiAccess.mockReset());
  const payload = { appointmentId: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5", orderId: "a8bad75c-b226-46d8-b238-86501998dd41" };
  const req = (origin = "http://localhost") => new Request("http://localhost/api/collections", { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": "972b2aed-30f9-4c01-9473-b8db9a6db88c" }, body: JSON.stringify(payload) });
  const patchReq = () => new Request("http://localhost/api/collections/14a5f9b4-8218-4930-8115-788e270b6df8", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "972b2aed-30f9-4c01-9473-b8db9a6db88c" }, body: JSON.stringify({ action: "delay", expectedVersion: 1, reason: "Synthetic traffic delay" }) });
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
  it("rejects missing authentication or incomplete MFA for a delay event", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await PATCH(patchReq(), { params: Promise.resolve({ id: "14a5f9b4-8218-4930-8115-788e270b6df8" }) })).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    expect((await PATCH(patchReq(), { params: Promise.resolve({ id: "14a5f9b4-8218-4930-8115-788e270b6df8" }) })).status).toBe(428);
  });
  it("rejects a past staff-estimated arrival before database access", async () => {
    const id = "14a5f9b4-8218-4930-8115-788e270b6df8";
    const request = new Request(`http://localhost/api/collections/${id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "972b2aed-30f9-4c01-9473-8bdb9a6db88c" }, body: JSON.stringify({ action: "delay", expectedVersion: 1, reason: "Synthetic traffic delay", estimatedArrivalAt: "2000-01-01T10:00:00.000Z" }) });
    const response = await PATCH(request, { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "estimated_arrival_must_be_future" });
    expect(getApiAccess).not.toHaveBeenCalled();
  });
});
