import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { GET } from "./route";

const centreId = "2c61e074-b10e-42be-a8d3-b2f9cf9c081d";
const staff = { organizationId: "org-a", grants: [{ key: "leads.read", centreId }] };

describe("centre-scoped communication draft queue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication and MFA before querying draft records", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await GET(new Request(`http://localhost/api/communications/drafts?centreId=${centreId}`));
    expect(response.status).toBe(428);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("leads.read", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns only centre-scoped draft metadata and never returns encrypted body data", async () => {
    const rows = [{ id: "draft-a", leadId: "lead-a", leadNumber: "RHC-L-1", purpose: "OPERATIONAL", channel: "PHONE", status: "DRAFT", createdAt: new Date("2026-11-01T10:00:00Z"), updatedAt: new Date("2026-11-01T10:00:00Z"), creatorName: "Synthetic Staff", creatorCode: "SYN-1" }];
    const chain = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), offset: vi.fn().mockResolvedValue(rows) };
    mocks.getApiAccess.mockResolvedValue({ staff, response: null });
    mocks.getDb.mockReturnValue({ select: vi.fn(() => chain) });
    const response = await GET(new Request(`http://localhost/api/communications/drafts?centreId=${centreId}&purpose=OPERATIONAL&page=1`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toMatchObject({ page: 1, pageSize: 25, hasMore: false, delivery: "DISABLED", drafts: [{ id: "draft-a", leadId: "lead-a", leadNumber: "RHC-L-1", creator: "Synthetic Staff (SYN-1)", canCancel: false }] });
    expect(JSON.stringify(payload)).not.toContain("private-ciphertext");
    expect(JSON.stringify(payload)).not.toContain("body");
    expect(chain.limit).toHaveBeenCalledWith(26);
  });

  it("projects draft cancellation only with centre-scoped activity-write permission", async () => {
    const rows = [{ id: "draft-b", leadId: "lead-b", leadNumber: "RHC-L-2", purpose: "OPERATIONAL", channel: "EMAIL", status: "DRAFT", createdAt: new Date("2026-11-01T10:00:00Z"), updatedAt: new Date("2026-11-01T10:00:00Z"), creatorName: "Synthetic Staff", creatorCode: "SYN-1" }];
    const chain = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), offset: vi.fn().mockResolvedValue(rows) };
    mocks.getApiAccess.mockResolvedValue({ staff: { ...staff, grants: [...staff.grants, { key: "leads.activities.write", centreId }] }, response: null });
    mocks.getDb.mockReturnValue({ select: vi.fn(() => chain) });
    const response = await GET(new Request(`http://localhost/api/communications/drafts?centreId=${centreId}`));
    const payload = await response.json();
    expect(payload.drafts[0]).toMatchObject({ id: "draft-b", canCancel: true });
  });


  it("does not query another centre when the caller lacks its lead read grant", async () => {
    const otherCentreId = "8d077abd-e14e-41f0-bced-90410704e41f";
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request(`http://localhost/api/communications/drafts?centreId=${otherCentreId}`));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("leads.read", otherCentreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects malformed filters before access or database queries", async () => {
    const response = await GET(new Request("http://localhost/api/communications/drafts?centreId=bad&channel=SMS"));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
