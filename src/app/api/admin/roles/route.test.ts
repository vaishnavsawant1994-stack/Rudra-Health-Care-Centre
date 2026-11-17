import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

describe("admin role definition authorization", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });

  it("does not read role data without roles.read", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects a delegated role manager before database mutation", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: null, staff: { isOwner: false, organizationId: "org", staffUserId: "staff", grants: [{ key: "roles.manage", centreId: null }] } });
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request("http://localhost/api/admin/roles", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ roleId: "d5a91d7b-9d1f-4fb9-9a77-f9f8a6f63011", permissionKeys: ["organization.manage"] }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
