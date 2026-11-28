import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "./route";
const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
const params = Promise.resolve({ id: "59662f2e-7ea5-42e6-b8ef-a2d68ed8fcdc" });

describe("Corporate and partner 360 cross-centre boundary", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });
  it("denies a corporate account read from an unrelated centre", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/business-relationships/59662f2e-7ea5-42e6-b8ef-a2d68ed8fcdc?centreId=63cc30b0-3278-4801-adf0-41d522adf587&type=CORPORATE"), { params });
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("corporate.read", "63cc30b0-3278-4801-adf0-41d522adf587");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("denies unassigned partner record updates before lookup or write", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await PATCH(new Request("http://localhost/api/business-relationships/59662f2e-7ea5-42e6-b8ef-a2d68ed8fcdc", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "e4228f01-d8a2-4f8a-9cbf-37dc02d81af2" }, body: JSON.stringify({ centreId: "63cc30b0-3278-4801-adf0-41d522adf587", type: "PARTNER", expectedVersion: 1, category: "SYNTHETIC", status: "ACTIVE", privateData: { name: "Synthetic Partner", legalName: null, primaryContactName: null, primaryContactRole: null, phone: null, email: null, address: null, agreementReference: null, agreementStatus: "PENDING_REVIEW", notes: null } }) }), { params });
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("partners.manage", "63cc30b0-3278-4801-adf0-41d522adf587");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
