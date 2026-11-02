import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { PATCH } from "./[id]/route";

const { getApiAccess } = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));

const centreId = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";
const orderId = "f06a9df7-3568-40f1-8977-ae85c19190c6";
const key = "6b6806c8-2353-4ac3-851b-21e3a7f9a48a";
const sameOrigin = { origin: "http://localhost", "content-type": "application/json" };

describe("diagnostic order route access gates", () => {
  beforeEach(() => getApiAccess.mockReset());

  it("rejects unauthenticated order creation before database access", async () => {
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    const request = new Request("http://localhost/api/orders", { method: "POST", headers: { ...sameOrigin, "idempotency-key": key }, body: JSON.stringify({ centreId, patientId: orderId, catalogueVersionIds: [orderId] }) });
    expect((await POST(request)).status).toBe(401);
    expect(getApiAccess).toHaveBeenCalledTimes(1);
  });

  it("rejects MFA-incomplete order confirmation before reading order data", async () => {
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const request = new Request(`http://localhost/api/orders/${orderId}`, { method: "PATCH", headers: sameOrigin, body: JSON.stringify({ action: "confirm", expectedVersion: 1 }) });
    expect((await PATCH(request, { params: Promise.resolve({ id: orderId }) })).status).toBe(428);
    expect(getApiAccess).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin mutations before authentication or writes", async () => {
    const request = new Request("http://localhost/api/orders", { method: "POST", headers: { origin: "http://attacker.invalid", "content-type": "application/json", "idempotency-key": key }, body: "{}" });
    expect((await POST(request)).status).toBe(403);
    expect(getApiAccess).not.toHaveBeenCalled();
  });
});
