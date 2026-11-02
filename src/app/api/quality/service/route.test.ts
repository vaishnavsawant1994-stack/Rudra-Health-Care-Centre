import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));
import { GET } from "./route";

describe("service quality aggregate access", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("denies unauthenticated or MFA-incomplete sessions without querying task data", async () => {
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await GET();
    expect(response.status).toBe(428);
    expect(getApiAccess).toHaveBeenCalledWith("tasks.support.read");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns aggregate counts using only the authorized centre scope", async () => {
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-synthetic", grants: [{ key: "tasks.support.read", centreId: "centre-synthetic" }] }, response: null });
    const where = vi.fn().mockResolvedValue([{ value: 2 }]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    getDb.mockReturnValue({ select });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summary: { open: 2, inProgress: 2, awaitingApproval: 2, completed: 2, overdue: 2 } });
    expect(select).toHaveBeenCalledTimes(5);
    expect(where).toHaveBeenCalledTimes(5);
  });
});
