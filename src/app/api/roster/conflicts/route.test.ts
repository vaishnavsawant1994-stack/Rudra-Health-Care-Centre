import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("roster conflict queue pagination", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("rejects invalid pages before authorization or database access", async () => {
    const base = "centreId=11111111-1111-4111-8111-111111111111&from=2026-10-26T00%3A00%3A00.000Z&to=2026-11-02T00%3A00%3A00.000Z";
    for (const page of ["0", "-1", "1.5", "100001", "invalid"]) {
      const response = await GET(new Request(`http://localhost/api/roster/conflicts?${base}&page=${encodeURIComponent(page)}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_page" });
    }
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  }, 15_000);
});
