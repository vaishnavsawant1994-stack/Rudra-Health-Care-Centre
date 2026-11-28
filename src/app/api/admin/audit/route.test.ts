import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn(), where: vi.fn(), offset: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

describe("authorized audit reader", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); mocks.where.mockReset(); mocks.offset.mockReset(); });

  it("rejects invalid filters before access or database work", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/audit?page=0"));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("checks explicit centre access before querying audit records", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/audit?centreId=2f73f2a3-cb42-4aab-a9fd-ed33f2fda405"));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("audit.read", "2f73f2a3-cb42-4aab-a9fd-ed33f2fda405");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("denies a centre-scoped audit grant instead of exposing organization-wide history", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "audit.read", centreId: "centre-a" }] }, response: null });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/audit?page=1"));
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns authorized organization-audit event pages without caching them", async () => {
    const row = { sequence: 12, centreId: "centre-a", action: "lead.created", entityType: "lead", entityId: "synthetic-id", details: { status: "NEW" }, recordedAt: new Date("2026-11-26T00:00:00Z") };
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "audit.read", centreId: null }] }, response: null });
    mocks.offset.mockResolvedValue([row]);
    mocks.where.mockImplementation(() => ({ orderBy: () => ({ limit: () => ({ offset: mocks.offset }) }) }));
    mocks.getDb.mockReturnValue({ select: () => ({ from: () => ({ where: mocks.where }) }) });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/audit?action=lead.created&from=2026-11-26&to=2026-11-26"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ events: [{ ...row, recordedAt: row.recordedAt.toISOString() }], page: 1, pageSize: 100, hasMore: false });
    expect(mocks.where).toHaveBeenCalledOnce();
    expect(mocks.offset).toHaveBeenCalledWith(0);
  });
});
