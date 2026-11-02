import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiAccess: vi.fn(),
  checkDatabase: vi.fn(),
  probeLocalClamAv: vi.fn(),
}));

vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ checkDatabase: mocks.checkDatabase }));
vi.mock("@/server/report-storage", () => ({ probeLocalClamAv: mocks.probeLocalClamAv }));

import { GET } from "./route";

describe("admin system health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiAccess.mockResolvedValue({ response: null });
    mocks.checkDatabase.mockResolvedValue(true);
    mocks.probeLocalClamAv.mockResolvedValue("AVAILABLE");
  });

  it("returns only sanitized local scanner health to authorized configuration readers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ database: "connected", reportScanner: "AVAILABLE" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("REPORT_CLAMAV_HOST");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("3310");
    expect(mocks.probeLocalClamAv).toHaveBeenCalledOnce();
  });

  it("does not probe the scanner when configuration access is denied", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.probeLocalClamAv).not.toHaveBeenCalled();
    expect(mocks.checkDatabase).not.toHaveBeenCalled();
  });
});
