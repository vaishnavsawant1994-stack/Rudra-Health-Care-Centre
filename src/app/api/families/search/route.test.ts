import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { POST } from "./route";

const centreA = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";
const centreB = "79925dd4-625b-4514-b9c1-0f97f5794bd9";

describe("family search authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unauthenticated request before reading family or patient records", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    const response = await POST(new Request("http://localhost/api/families/search", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ q: "Synthetic family", centreId: centreA }),
    }));
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires both family and patient read scope in a selected centre", async () => {
    mocks.getApiAccess
      .mockResolvedValueOnce({ response: null, staff: { organizationId: "org-a", grants: [{ key: "families.read", centreId: centreA }] } })
      .mockResolvedValueOnce({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await POST(new Request("http://localhost/api/families/search", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ q: "Synthetic family", centreId: centreB }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects malformed scopes before authentication or database access", async () => {
    const response = await POST(new Request("http://localhost/api/families/search", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ q: "Synthetic", centreId: "invalid" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
