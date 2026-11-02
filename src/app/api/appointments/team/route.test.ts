import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("appointment team schedule pagination boundary", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it.each(["0", "-1", "1.5", "100001", "not-a-number"])("rejects invalid page %s before auth or database access", async (page) => {
    const response = await GET(new Request(`http://localhost/api/appointments/team?centreId=00000000-0000-4000-8000-000000000001&date=2026-10-30&page=${page}`));
    expect(response.status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });
});
