import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));
import { GET } from "./route";

describe("escalation assignee lookup", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("rejects a malformed centre before authorization or database access", async () => {
    const response = await GET(new Request("http://localhost/api/escalations/assignees?centreId=invalid"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_centre" });
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires centre-scoped escalation management before querying staff", async () => {
    getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/escalations/assignees?centreId=11111111-1111-4111-8111-111111111111"));
    expect(response.status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("escalations.manage", "11111111-1111-4111-8111-111111111111");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns only staff from the caller organization with escalation-read role grants", async () => {
    const rows = [{ id: "22222222-2222-4222-8222-222222222222", displayName: "Synthetic manager", staffCode: "S-01" }];
    const query = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(rows) };
    getApiAccess.mockResolvedValue({ staff: { organizationId: "33333333-3333-4333-8333-333333333333" }, response: null });
    getDb.mockReturnValue({ selectDistinct: vi.fn(() => query) });
    const response = await GET(new Request("http://localhost/api/escalations/assignees?centreId=11111111-1111-4111-8111-111111111111"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ staff: rows });
    expect(query.innerJoin).toHaveBeenCalledTimes(4);
    expect(query.where).toHaveBeenCalledTimes(1);
  });
});
