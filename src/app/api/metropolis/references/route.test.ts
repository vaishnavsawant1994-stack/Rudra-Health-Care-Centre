import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("manual Metropolis reference API boundary", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("requires an authorized sample session to read mappings", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/metropolis/references"))).status).toBe(401);
    expect(getApiAccess).toHaveBeenCalledWith("samples.read", undefined);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects incomplete submissions before database access", async () => {
    const request = new Request("http://localhost/api/metropolis/references", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "972b2aed-30f9-4c01-9473-b8db9a6db88c" }, body: JSON.stringify({ referenceType: "SPECIMEN" }) });
    expect((await POST(request)).status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires center-scoped integration permission before saving", async () => {
    const centreId = "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5";
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const request = new Request("http://localhost/api/metropolis/references", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "972b2aed-30f9-4c01-9473-b8db9a6db88c" }, body: JSON.stringify({ centreId, orderId: centreId, referenceType: "ORDER", externalReference: "SYNTHETIC-EXT-1", evidenceReference: "SYNTHETIC-DOC-1", reason: "Synthetic authorization test" }) });
    expect((await POST(request)).status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("samples.external.verify", centreId);
    expect(getDb).not.toHaveBeenCalled();
  });
});
