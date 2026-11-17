import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

describe("Doctor CRM authorization boundary", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });
  it("validates the requested centre before any database access", async () => {
    const response = await GET(new Request("http://localhost/api/doctors?centreId=bad"));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("denies a doctor directory read outside the caller's centre permission", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/doctors?centreId=63cc30b0-3278-4801-adf0-41d522adf587"));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("doctors.read", "63cc30b0-3278-4801-adf0-41d522adf587");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("denies doctor profile creation before reading or writing data", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await POST(new Request("http://localhost/api/doctors", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "7e0a96c6-d393-4c50-a39e-42093cd15c89" }, body: JSON.stringify({ centreId: "63cc30b0-3278-4801-adf0-41d522adf587", name: "Synthetic Doctor", specialty: "Synthetic review", registrationReference: "SYNTHETIC-REG-001" }) }));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("doctors.manage", "63cc30b0-3278-4801-adf0-41d522adf587");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
