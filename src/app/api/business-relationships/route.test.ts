import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

describe("Corporate and partner directory authorization boundary", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });
  it("rejects malformed centre and type filters before data access", async () => {
    const response = await GET(new Request("http://localhost/api/business-relationships?centreId=bad&type=PARTNER"));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("denies an unrelated corporate account centre before reading records", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/business-relationships?centreId=63cc30b0-3278-4801-adf0-41d522adf587&type=CORPORATE"));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("corporate.read", "63cc30b0-3278-4801-adf0-41d522adf587");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("denies partner onboarding in an unassigned centre before data access", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await POST(new Request("http://localhost/api/business-relationships", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "e4228f01-d8a2-4f8a-9cbf-37dc02d81af2" }, body: JSON.stringify({ centreId: "63cc30b0-3278-4801-adf0-41d522adf587", type: "PARTNER", category: "LABORATORY", privateData: { name: "Synthetic Partner", agreementStatus: "PENDING_REVIEW" } }) }));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("partners.manage", "63cc30b0-3278-4801-adf0-41d522adf587");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
