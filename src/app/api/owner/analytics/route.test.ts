import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { GET } from "./route";

describe("owner operational analytics route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid and overlong ranges before authentication or querying", async () => {
    const invalid = await GET(new Request("http://localhost/api/owner/analytics?from=2026-11-02&to=2026-11-01"));
    expect(invalid.status).toBe(400);
    const overlong = await GET(new Request("http://localhost/api/owner/analytics?from=2025-10-30&to=2026-11-01"));
    expect(overlong.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires completed organization authorization before reading centres", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await GET(new Request("http://localhost/api/owner/analytics?from=2026-10-01&to=2026-10-31"));
    expect(response.status).toBe(428);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("organization.read", undefined);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
