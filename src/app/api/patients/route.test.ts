import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn(), appendAuditEvent: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

import { GET, POST } from "./route";
import { POST as searchPatients } from "./search/route";

const centreA = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";
const centreB = "79925dd4-625b-4514-b9c1-0f97f5794bd9";

describe("patient collection API authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("rejects an unauthenticated list request before querying patient data", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    const response = await GET(new Request("http://localhost/api/patients"));
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects a request for another centre before querying patient data", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: null, staff: { organizationId: "org-a", grants: [{ key: "patients.read", centreId: centreA }] } });
    const response = await GET(new Request(`http://localhost/api/patients?centreId=${centreB}`));
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated registration even with a valid synthetic payload", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    const response = await POST(new Request("http://localhost/api/patients", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ centreId: centreA, firstName: "Synthetic", lastName: "Person", dateOfBirth: "1990-01-01", phone: "+919876543210", consentStatus: "GRANTED", consentMethod: "IN_PERSON" }),
    }));
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated patient search without putting search terms in the URL", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    const request = new Request("http://localhost/api/patients/search", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ q: "Synthetic Person", centreId: centreA }),
    });
    expect(new URL(request.url).search).toBe("");
    const response = await searchPatients(request);
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects search terms supplied in a query string so they cannot enter URL access logs", async () => {
    const response = await GET(new Request("http://localhost/api/patients?q=Synthetic%20Person"));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
