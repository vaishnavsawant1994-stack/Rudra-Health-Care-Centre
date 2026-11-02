import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn(), appendAuditEvent: vi.fn(), listPublicCatalogueCentres: vi.fn(), getPublicCatalogueItem: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: mocks.appendAuditEvent }));
vi.mock("@/server/public-catalogue", () => ({ listPublicCatalogueCentres: mocks.listPublicCatalogueCentres, getPublicCatalogueItem: mocks.getPublicCatalogueItem }));

import { GET, POST, PATCH } from "./route";

const centreId = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";
const validBody = { centreId, firstName: "Synthetic", lastName: "Enquirer", phone: "+919876543210", category: "GENERAL", message: "Please call about test availability.", responsePermission: false };

describe("public enquiry intake boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a cross-origin intake before reading centre data", async () => {
    const response = await POST(new Request("http://localhost/api/public/enquiries", { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json", "idempotency-key": "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34" }, body: JSON.stringify(validBody) }));
    expect(response.status).toBe(403);
    expect(mocks.listPublicCatalogueCentres).not.toHaveBeenCalled();
  });

  it("requires an idempotency key for valid submissions", async () => {
    const response = await POST(new Request("http://localhost/api/public/enquiries", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(validBody) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "idempotency_key_required" });
  });

  it("requires a preferred date and complete address for a home collection booking request", async () => {
    const response = await POST(new Request("http://localhost/api/public/enquiries", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34" }, body: JSON.stringify({ ...validBody, requestKind: "BOOKING_REQUEST", visitType: "HOME_COLLECTION" }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
    expect(mocks.listPublicCatalogueCentres).not.toHaveBeenCalled();
  });

  it("requires a selected catalogue id and version together", async () => {
    const response = await POST(new Request("http://localhost/api/public/enquiries", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34" }, body: JSON.stringify({ ...validBody, requestedCatalogueItemId: centreId }) }));
    expect(response.status).toBe(400);
    expect(mocks.getPublicCatalogueItem).not.toHaveBeenCalled();
  });

  it("silently accepts honeypot submissions without persisting them", async () => {
    const response = await POST(new Request("http://localhost/api/public/enquiries", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34" }, body: JSON.stringify({ ...validBody, website: "spam" }) }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(mocks.listPublicCatalogueCentres).not.toHaveBeenCalled();
  });

  it("rejects invalid centre filters before querying authorized data", async () => {
    const response = await GET(new Request("http://localhost/api/public/enquiries?centreId=not-a-uuid"));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
  });

  it("requires scoped lead-read authorization before returning encrypted submissions", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`));
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("marks the authenticated contact-data directory response private and non-cacheable", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-synthetic", grants: [] } });
    const query = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn().mockResolvedValue([]) };
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue(query) });

    const response = await GET(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ enquiries: [], page: 1, pageSize: 50, hasMore: false });
  });

  it("returns a private, minimized queue projection without decrypting enquiry data", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-synthetic", grants: [] } });
    const rows = [{ id: "synthetic-id", reference: "RHC-W-SYNTH-01", status: "PENDING_REVIEW", centreId, createdAt: new Date("2026-01-01T00:00:00Z") }];
    const query = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn().mockResolvedValue(rows) };
    query.from.mockReturnValue(query); query.where.mockReturnValue(query); query.orderBy.mockReturnValue(query); query.limit.mockReturnValue(query);
    mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue(query) });

    const response = await GET(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&summary=true`));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload).toMatchObject({ enquiries: [{ ...rows[0], createdAt: "2026-01-01T00:00:00.000Z" }], page: 1, pageSize: 25, hasMore: false });
    expect(JSON.stringify(payload)).not.toContain("firstName");
  });

  it("rejects malformed review actions before reading an enquiry", async () => {
    const response = await PATCH(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: centreId, action: "APPROVE" }) }));
    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
