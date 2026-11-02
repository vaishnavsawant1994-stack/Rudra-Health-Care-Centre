import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn(), selectedQueries: [] as Array<Record<string, unknown>> }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: vi.fn() }));
vi.mock("@/server/operational-crypto", () => ({ encryptOperationalData: vi.fn(() => "encrypted"), decryptOperationalData: vi.fn(() => ({ name: "Synthetic campaign", description: null })), operationalContext: vi.fn((value, recordType) => ({ ...value, recordType })) }));
vi.mock("@/server/csrf", () => ({ isSameOriginRequest: (request: Request) => request.headers.get("origin") === new URL(request.url).origin, csrfRejected: () => Response.json({ error: "same_origin_required" }, { status: 403 }) }));

import { GET, POST } from "./route";

const centreId = "2c61e074-b10e-42be-a8d3-b2f9cf9c081d";

describe("marketing campaign access controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires completed authentication and MFA before querying campaigns", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await GET(new Request(`http://localhost/api/marketing/campaigns?centreId=${centreId}`));
    expect(response.status).toBe(428);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("marketing.read", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("does not reveal campaigns for a centre outside the staff grant", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "marketing.read", centreId: "8d077abd-e14e-41f0-bced-90410704e41f" }] }, response: null });
    const response = await GET(new Request(`http://localhost/api/marketing/campaigns?centreId=${centreId}`));
    expect(response.status).toBe(404);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns centre-scoped attributed and converted lead counts from conversion records", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", staffUserId: "staff-a", grants: [{ key: "marketing.read", centreId }] }, response: null });
    const campaign = { id: "campaign-a", organizationId: "org-a", centreId, campaignCode: "SYN-01", channel: "WEBSITE", status: "ACTIVE", startsOn: null, endsOn: null, versionNumber: 1, privateDataCiphertext: "ciphertext", createdByStaffId: "staff-a", updatedByStaffId: "staff-a", idempotencyKey: "key", requestHash: "hash", createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z") };
    const results = [[campaign], [{ campaignId: campaign.id, count: 12 }], [{ campaignId: campaign.id, count: 3 }]];
    mocks.selectedQueries.length = 0;
    mocks.getDb.mockReturnValue({ select: vi.fn(() => {
      const call = mocks.selectedQueries.length;
      const query: Record<string, unknown> = {};
      for (const method of ["from", "innerJoin", "where", "orderBy"]) query[method] = vi.fn(() => query);
      query.limit = vi.fn(async () => results[call] ?? []);
      query.groupBy = vi.fn(async () => results[call] ?? []);
      mocks.selectedQueries.push(query);
      return query;
    }) });
    const response = await GET(new Request(`http://localhost/api/marketing/campaigns?centreId=${centreId}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaigns[0]).toMatchObject({ campaignCode: "SYN-01", attributedLeadCount: 12, convertedLeadCount: 3, conversionRatePercent: 25 });
    expect(mocks.selectedQueries).toHaveLength(3);
    expect(mocks.selectedQueries[2]?.innerJoin).toHaveBeenCalledOnce();
    expect(mocks.selectedQueries[2]?.where).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin and invalid campaign writes before database access", async () => {
    const crossOrigin = await POST(new Request("http://localhost/api/marketing/campaigns", { method: "POST", headers: { origin: "https://invalid.example", "content-type": "application/json" }, body: "{}" }));
    expect(crossOrigin.status).toBe(403);
    const invalid = await POST(new Request("http://localhost/api/marketing/campaigns", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId, campaignCode: "bad code", name: "X", channel: "SOCIAL", idempotencyKey: "8d077abd-e14e-41f0-bced-90410704e41f" }) }));
    expect(invalid.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
