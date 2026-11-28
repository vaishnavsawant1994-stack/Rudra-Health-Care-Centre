import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

describe("admin assignment centre authorization", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });

  it("rejects assignments outside the actor's centre scope before opening a transaction", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: null, staff: { organizationId: "org", staffUserId: "actor", isOwner: false, grants: [{ key: "assignments.manage", centreId: "d5a91d7b-9d1f-4fb9-9a77-f9f8a6f63011" }] } });
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/admin/assignments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ staffUserId: "b4d1135c-d319-48a8-9de8-bd68ec4f5abc", roleId: "a87a69d9-54b2-4fb1-940b-cdb8ae85ddf2", centreId: "2f73f2a3-cb42-4aab-a9fd-ed33f2fda405" }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
