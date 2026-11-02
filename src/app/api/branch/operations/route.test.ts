import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("centre operations API boundary", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("rejects signed-out and MFA-incomplete requests before querying aggregate data", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await GET()).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    expect((await GET()).status).toBe(428);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("omits team roster counts for a reader whose roster access is self-scoped", async () => {
    getApiAccess.mockResolvedValue({ staff: {
      organizationId: "org-1", staffUserId: "staff-1", grants: [{ key: "roster.read", centreId: "centre-1" }],
    } });
    const query = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ id: "centre-1", code: "MAIN", name: "Main Centre", timeZone: "Asia/Kolkata" }]),
    };
    const select = vi.fn(() => query);
    getDb.mockReturnValue({ select });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.centres[0].metrics).not.toHaveProperty("scheduledStaff");
    expect(body.centres[0].metrics).not.toHaveProperty("staffUnavailable");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("scopes a field worker's sample exception count and queue through assigned collection jobs", async () => {
    getApiAccess.mockResolvedValue({ staff: {
      organizationId: "org-1", staffUserId: "field-1", grants: [
        { key: "samples.read", centreId: "centre-1" },
        { key: "samples.collect", centreId: "centre-1" },
      ],
    } });
    const centreQuery = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ id: "centre-1", code: "MAIN", name: "Main Centre", timeZone: "Asia/Kolkata" }]),
    };
    const countQuery = {
      from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ value: 2 }]),
    };
    const queueQuery = {
      from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: "exception-1", kind: "MISSING_LABEL", status: "OPEN", createdAt: new Date("2026-11-01T00:00:00Z") }]),
    };
    const select = vi.fn().mockReturnValueOnce(centreQuery).mockReturnValueOnce(countQuery).mockReturnValueOnce(queueQuery);
    getDb.mockReturnValue({ select });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.centres[0].metrics.openExceptions).toBe(2);
    expect(body.centres[0].queue).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "SAMPLE_EXCEPTION", id: "exception-1" })]));
    expect(countQuery.innerJoin).toHaveBeenCalledTimes(2);
    expect(queueQuery.innerJoin).toHaveBeenCalledTimes(2);
  });
});
