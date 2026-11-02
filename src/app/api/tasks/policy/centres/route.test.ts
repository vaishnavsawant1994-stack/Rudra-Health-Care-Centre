import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("approval policy centre selector API", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("requires policy-management access before querying centres", async () => {
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("tasks.policy.manage");
    expect(getDb).not.toHaveBeenCalled();
  });
});
