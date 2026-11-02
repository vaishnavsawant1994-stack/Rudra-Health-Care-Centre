import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess } = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));

import { getCollectionReadAccess } from "./collection-access";

describe("collection read access", () => {
  beforeEach(() => getApiAccess.mockReset());

  it("keeps broad collection readers on their existing access path", async () => {
    const allowed = { staff: { staffUserId: "staff" }, response: null };
    getApiAccess.mockResolvedValue(allowed);
    await expect(getCollectionReadAccess("centre-a")).resolves.toBe(allowed);
    expect(getApiAccess).toHaveBeenCalledExactlyOnceWith("collections.read", "centre-a");
  });

  it("falls back only from a permission denial to assigned visit access", async () => {
    const denied = { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
    const allowed = { staff: { staffUserId: "collector" }, response: null };
    getApiAccess.mockResolvedValueOnce(denied).mockResolvedValueOnce(allowed);
    await expect(getCollectionReadAccess()).resolves.toBe(allowed);
    expect(getApiAccess.mock.calls).toEqual([["collections.read", undefined], ["collections.visit.record", undefined]]);
  });

  it("does not turn unauthenticated, MFA, or unavailable responses into permission fallback", async () => {
    for (const status of [401, 428, 503]) {
      getApiAccess.mockReset().mockResolvedValue({ staff: null, response: Response.json({ error: "blocked" }, { status }) });
      const result = await getCollectionReadAccess("centre-a");
      expect(result.response?.status).toBe(status);
      expect(getApiAccess).toHaveBeenCalledExactlyOnceWith("collections.read", "centre-a");
    }
  });
});
