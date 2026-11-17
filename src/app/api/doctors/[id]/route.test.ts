import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "./route";
const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
const params = Promise.resolve({ id: "59662f2e-7ea5-42e6-b8ef-a2d68ed8fcdc" });

describe("Doctor 360 cross-centre boundary", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });
  it("denies a profile read from an unrelated centre before querying profile data", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/doctors/59662f2e-7ea5-42e6-b8ef-a2d68ed8fcdc?centreId=63cc30b0-3278-4801-adf0-41d522adf587"), { params });
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("doctors.read", "63cc30b0-3278-4801-adf0-41d522adf587");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("denies cross-centre profile updates before any data access", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await PATCH(new Request("http://localhost/api/doctors/59662f2e-7ea5-42e6-b8ef-a2d68ed8fcdc", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "7e0a96c6-d393-4c50-a39e-42093cd15c89" }, body: JSON.stringify({ centreId: "63cc30b0-3278-4801-adf0-41d522adf587", expectedVersion: 1, name: "Synthetic Doctor", specialty: "Synthetic specialty", phone: null, email: null, registrationReference: null, affiliation: null, notes: null, status: "ACTIVE" }) }), { params });
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("doctors.manage", "63cc30b0-3278-4801-adf0-41d522adf587");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
