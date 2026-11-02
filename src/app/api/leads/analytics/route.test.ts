import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn(), visibleLeadCentres: vi.fn(), hasLeadCentrePermission: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/lead-policy", () => ({ visibleLeadCentres: mocks.visibleLeadCentres, hasLeadCentrePermission: mocks.hasLeadCentrePermission }));

import { GET } from "./route";

const centreA = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";
const centreB = "79925dd4-625b-4514-b9c1-0f97f5794bd9";

describe("CRM aggregate analytics API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated requests before database access", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/leads/analytics"))).status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects cross-centre scope before database access", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await GET(new Request(`http://localhost/api/leads/analytics?centreId=${centreB}`))).status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("leads.read", centreB);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("validates dates and rejects ranges wider than one year before querying", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org", grants: [{ key: "leads.read", centreId: centreA }] } });
    mocks.visibleLeadCentres.mockReturnValue([centreA]);
    expect((await GET(new Request("http://localhost/api/leads/analytics?from=2026-02-30"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/leads/analytics?from=2024-12-31&to=2026-01-01"))).status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
