import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

describe("relationship pipeline privacy boundary", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });
  it("does not query any relationship data when the caller lacks every directory permission", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/relationships/pipeline"));
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects malformed centre filters before authorization or data access", async () => {
    const response = await GET(new Request("http://localhost/api/relationships/pipeline?centreId=bad"));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
