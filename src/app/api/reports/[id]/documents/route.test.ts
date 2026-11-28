import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), execute: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: vi.fn() }));

import { GET } from "./route";

describe("report document access centre scope", () => {
  const reportId = "e0b4892f-f838-42f4-9942-7f329e19b23a";
  const centreId = "60350a83-5d59-463a-a44d-e4473ec7bdbc";

  beforeEach(() => {
    mocks.getApiAccess.mockReset();
    mocks.execute.mockReset().mockResolvedValue({ rows: [{ centre_id: centreId, status: "QUARANTINED" }] });
    mocks.getApiAccess.mockImplementation(async (_permission: string, requestedCentre?: string) => {
      if (!requestedCentre) return { staff: { organizationId: "synthetic-org", staffUserId: "synthetic-staff" }, response: null };
      return { response: Response.json({ error: "forbidden" }, { status: 403 }) };
    });
  });

  it("checks centre permission before returning quarantine state", async () => {
    const response = await GET(new Request(`http://localhost/api/reports/${reportId}/documents`), { params: Promise.resolve({ id: reportId }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(mocks.getApiAccess.mock.calls).toEqual([["reports.read"], ["reports.read", centreId]]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps quarantined document access locked for an authorized centre reader", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "synthetic-org", staffUserId: "synthetic-staff" }, response: null });
    const response = await GET(new Request(`http://localhost/api/reports/${reportId}/documents`), { params: Promise.resolve({ id: reportId }) });
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ error: "report_access_revoked_or_unavailable" });
    expect(mocks.getApiAccess.mock.calls).toEqual([["reports.read"], ["reports.read", centreId]]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
