import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn(), searchAuthorizedLeads: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/lead-directory", () => ({ searchAuthorizedLeads: mocks.searchAuthorizedLeads }));

import { POST } from "./route";

const centreA = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";
const centreB = "79925dd4-625b-4514-b9c1-0f97f5794bd9";

describe("lead search authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated search before reading lead contacts", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    const response = await POST(new Request("http://localhost/api/leads/search", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ q: "Synthetic", centreId: centreA }) }));
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("denies cross-centre search before querying the CRM database", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await POST(new Request("http://localhost/api/leads/search", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ q: "Synthetic", centreId: centreB }) }));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("leads.read", centreB);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires POST and keeps search text out of URL parameters", async () => {
    const request = new Request("http://localhost/api/leads/search", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ q: "name@example.test" }) });
    expect(new URL(request.url).search).toBe("");
    const queryRequest = new Request("http://localhost/api/leads/search?q=name@example.test", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({}) });
    expect((await POST(queryRequest)).status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("passes the assigned-staff filter into the authorized directory query", async () => {
    const staff = { organizationId: crypto.randomUUID(), staffUserId: crypto.randomUUID(), grants: [{ key: "leads.read", centreId: centreA }] };
    mocks.getApiAccess.mockResolvedValue({ staff });
    mocks.searchAuthorizedLeads.mockResolvedValue(Response.json({ leads: [], total: 0 }));
    const assignedStaffId = crypto.randomUUID();
    const response = await POST(new Request("http://localhost/api/leads/search", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ q: "", centreId: centreA, assignedStaffId, page: 1, pageSize: 25 }) }));
    expect(response.status).toBe(200);
    expect(mocks.searchAuthorizedLeads).toHaveBeenCalledWith(staff, expect.objectContaining({ centreId: centreA, assignedStaffId }));
  });
});
