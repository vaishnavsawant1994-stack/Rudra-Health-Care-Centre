import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

describe("admin session controls", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });

  it("does not list sessions without sessions.read", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires same-origin requests before attempting revocation", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost/api/admin/sessions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "synthetic-session-id" }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "same_origin_required" });
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
