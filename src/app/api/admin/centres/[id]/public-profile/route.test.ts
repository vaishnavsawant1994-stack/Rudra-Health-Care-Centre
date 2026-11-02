import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { GET, PUT } from "./route";

const centreId = "b9ebbb46-49fd-49d2-95d2-976e22691e13";
const context = { params: Promise.resolve({ id: centreId }) };

describe("centre public profile API access boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("does not authorize malformed object identifiers", async () => {
    const response = await GET(new Request("https://rudra.invalid/api"), { params: Promise.resolve({ id: "not-an-id" }) });
    expect(response.status).toBe(404);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
  });

  it("requires centre-scoped management permission before reading encrypted profile data", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("https://rudra.invalid/api"), context);
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("centres.manage", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects cross-origin updates before authorization or persistence", async () => {
    const request = new Request("https://rudra.invalid/api", { method: "PUT", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: "{}" });
    const response = await PUT(request, context);
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires centre-scoped management permission before updates", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const request = new Request("https://rudra.invalid/api", { method: "PUT", headers: { origin: "https://rudra.invalid", "content-type": "application/json" }, body: "{}" });
    const response = await PUT(request, context);
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("centres.manage", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
