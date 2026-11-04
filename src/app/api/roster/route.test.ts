import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));
import { GET, POST } from "./route";

describe("roster queue pagination", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("rejects invalid pages before authorization or database access", async () => {
    const base = "centreId=11111111-1111-4111-8111-111111111111&from=2026-10-26T00%3A00%3A00.000Z&to=2026-11-02T00%3A00%3A00.000Z";
    for (const page of ["0", "-1", "1.5", "100001", "invalid"]) {
      const response = await GET(new Request(`http://localhost/api/roster?${base}&page=${encodeURIComponent(page)}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_page" });
    }
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("does not let a self-scoped roster reader request a coworker's schedule", async () => {
    const staff = { organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", staffUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", grants: [{ key: "roster.read", centreId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }] };
    getApiAccess.mockResolvedValue({ staff, response: null });
    const response = await GET(new Request("http://localhost/api/roster?centreId=dddddddd-dddd-4ddd-8ddd-dddddddddddd&staffId=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee&from=2026-10-26T00%3A00%3A00.000Z&to=2026-11-02T00%3A00%3A00.000Z"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(getApiAccess).toHaveBeenCalledWith("roster.read", "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a roster write whose timezone differs from the authorized centre", async () => {
    const staff = { organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", staffUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    getApiAccess.mockResolvedValue({ staff, response: null });
    const query = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ timeZone: "Asia/Kolkata" }]) };
    const db = { select: vi.fn(() => query), transaction: vi.fn() };
    getDb.mockReturnValue(db);
    const response = await POST(new Request("http://localhost/api/roster", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      body: JSON.stringify({ centreId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", staffId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", shiftType: "SCHEDULED", startsAt: "2026-10-30T03:30:00.000Z", endsAt: "2026-10-30T11:30:00.000Z", timeZone: "America/Los_Angeles", note: "Synthetic schedule" }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "centre_timezone_mismatch" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
