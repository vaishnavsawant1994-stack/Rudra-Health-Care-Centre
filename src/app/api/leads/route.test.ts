import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { GET, POST } from "./route";

const centreId = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";

describe("lead collection authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated listing before CRM data is read", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    const response = await GET(new Request("http://localhost/api/leads?centreId=" + centreId));
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects search terms in URL query strings", async () => {
    const response = await GET(new Request("http://localhost/api/leads?q=person%40example.test"));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated lead creation before database access", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    const response = await POST(new Request("http://localhost/api/leads", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId, firstName: "Synthetic", lastName: "Enquirer", phone: "+919876543210", enquiryCategory: "GENERAL", source: "WALK_IN" }) }));
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires the matching relationship read permission before linking a corporate referral", async () => {
    mocks.getApiAccess
      .mockResolvedValueOnce({ staff: { organizationId: "org-a", staffUserId: "staff-a", grants: [{ key: "leads.create", centreId }] }, response: null })
      .mockResolvedValueOnce({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await POST(new Request("http://localhost/api/leads", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId, firstName: "Synthetic", lastName: "Referral", phone: "+919876543211", enquiryCategory: "GENERAL", source: "CORPORATE", sourceRelationshipId: "c3000000-0000-4000-8000-000000000001" }) }));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenNthCalledWith(2, "corporate.read", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects relationship attribution on a non-corporate/non-partner source", async () => {
    const response = await POST(new Request("http://localhost/api/leads", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId, firstName: "Synthetic", lastName: "Referral", phone: "+919876543212", enquiryCategory: "GENERAL", source: "MANUAL", sourceRelationshipId: "c3000000-0000-4000-8000-000000000001" }) }));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires doctor-read permission before accepting a doctor referral link", async () => {
    mocks.getApiAccess
      .mockResolvedValueOnce({ staff: { organizationId: "org-a", staffUserId: "staff-a", grants: [{ key: "leads.create", centreId }] }, response: null })
      .mockResolvedValueOnce({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await POST(new Request("http://localhost/api/leads", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId, firstName: "Synthetic", lastName: "Doctor Referral", phone: "+919876543213", enquiryCategory: "GENERAL", source: "REFERRAL", sourceDoctorId: "c3000000-0000-4000-8000-000000000002" }) }));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenNthCalledWith(2, "doctors.read", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
