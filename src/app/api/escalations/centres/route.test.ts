import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("escalation centre selector authorization", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("rejects unknown views", async () => {
    const response = await GET(new Request("http://localhost/api/escalations/centres?view=all"));
    expect(response.status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
  });

  it("keeps creation centre lookup behind create permission", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/escalations/centres?view=create"));
    expect(response.status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("escalations.create");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires escalation read access before querying centre choices", async () => {
    getApiAccess
      .mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) })
      .mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/escalations/centres?view=read"));
    expect(response.status).toBe(403);
    expect(getApiAccess.mock.calls).toEqual([["escalations.read"], ["escalations.assigned.read"]]);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns only the read-granted centre for a centre-scoped reader", async () => {
    const centre = { id: "centre-a", code: "A", name: "Synthetic Centre A" };
    getApiAccess.mockResolvedValueOnce({ staff: { staffUserId: "staff-a", organizationId: "org-a", grants: [{ key: "escalations.read", centreId: "centre-a" }] }, response: null });
    const query = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn() };
    query.from.mockReturnValue(query); query.where.mockReturnValue(query); query.orderBy.mockResolvedValue([centre]);
    getDb.mockReturnValue({ select: vi.fn(() => query) });
    const response = await GET(new Request("http://localhost/api/escalations/centres?view=read"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ centres: [centre] });
    expect(query.orderBy).toHaveBeenCalledOnce();
  });
});
