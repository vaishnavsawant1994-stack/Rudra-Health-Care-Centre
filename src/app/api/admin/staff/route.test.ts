import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

describe("admin staff provisioning authorization", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });

  it("rejects centre-only staff.manage grants for organization-wide provisioning", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: null, staff: { organizationId: "org", staffUserId: "actor", isOwner: false, grants: [{ key: "staff.manage", centreId: "d5a91d7b-9d1f-4fb9-9a77-f9f8a6f63011" }] } });
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/admin/staff", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ displayName: "Synthetic Staff", email: "synthetic@example.test", password: "Synthetic-Only-Passphrase-2026" }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
