import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), execute: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: () => ({ execute: mocks.execute }) }));

import { GET } from "./route";

describe("referral attribution report", () => {
  beforeEach(() => {
    mocks.getApiAccess.mockReset(); mocks.execute.mockReset();
    const staff = { organizationId: "org-a", staffUserId: "staff-a", grants: [{ key: "leads.read", centreId: "centre-a" }, { key: "doctors.read", centreId: "centre-a" }] };
    mocks.getApiAccess.mockResolvedValue({ response: null, staff });
    mocks.execute.mockResolvedValue({ rows: [{ source_id: "source-a", source_number: "RHC-D-2026-AAAA1111", descriptor: "Pathology", status: "ACTIVE", lead_count: 4, converted_count: 2 }] });
  });

  it("returns centre-scoped referral counts without contact or patient fields", async () => {
    const response = await GET(new Request("http://localhost/api/relationships/referrals?centreId=00000000-0000-4000-8000-000000000001&type=DOCTOR"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.referrals).toEqual([{ sourceId: "source-a", sourceNumber: "RHC-D-2026-AAAA1111", descriptor: "Pathology", status: "ACTIVE", leads: 4, converted: 2 }]);
    expect(JSON.stringify(body)).not.toMatch(/phone|email|patientName|medical/i);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("requires both lead and relationship read authorization for the requested centre", async () => {
    mocks.getApiAccess.mockImplementation(async (permission: string) => permission === "leads.read"
      ? { response: null, staff: { organizationId: "org-a", staffUserId: "staff-a", grants: [] } }
      : { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null });
    const response = await GET(new Request("http://localhost/api/relationships/referrals?centreId=00000000-0000-4000-8000-000000000001&type=DOCTOR"));
    expect(response.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not combine permissions from different staff identities", async () => {
    mocks.getApiAccess.mockImplementation(async (permission: string) => ({
      response: null,
      staff: { organizationId: "org-a", staffUserId: permission === "leads.read" ? "staff-a" : "staff-b", grants: [] },
    }));
    const response = await GET(new Request("http://localhost/api/relationships/referrals?centreId=00000000-0000-4000-8000-000000000001&type=DOCTOR"));
    expect(response.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("rejects invalid or one-sided date ranges before database access", async () => {
    for (const query of ["from=2026-02-30&to=2026-03-01", "from=2026-01-01", "from=2025-01-01&to=2026-12-31"]) {
      const response = await GET(new Request(`http://localhost/api/relationships/referrals?centreId=00000000-0000-4000-8000-000000000001&type=DOCTOR&${query}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
