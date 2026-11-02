import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealWebsiteContent } from "@/server/website-content";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: vi.fn() }));

const staff = { organizationId: "22222222-2222-4222-8222-222222222222", staffUserId: "11111111-1111-4111-8111-111111111111", grants: [{ key: "website.content.manage", centreId: null }] };
function request(body: unknown, origin = "http://localhost") { return new Request("http://localhost/api/admin/website-content", { method: "PUT", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }

describe("website content administration API boundaries", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getDb.mockReturnValue({}); });
  afterEach(() => { delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; });
  it("requires the content management permission to read drafts", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const { GET } = await import("./route"); const response = await GET(new Request("http://localhost/api/admin/website-content"));
    expect(response.status).toBe(403); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects cross-origin changes before authentication or database access", async () => {
    const { PUT } = await import("./route"); const response = await PUT(request({}, "https://attacker.invalid"));
    expect(response.status).toBe(403); expect(mocks.getApiAccess).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects unsupported and legal-policy slugs instead of creating arbitrary public pages", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff, response: null });
    const { PUT } = await import("./route");
    for (const slug of ["privacy", "terms", "../owner"]) {
      const response = await PUT(request({ slug, action: "SAVE_DRAFT", content: { title: "Synthetic", summary: "Summary", sections: [{ heading: "Info", body: "Text" }] }, expectedVersion: 0 }));
      expect(response.status).toBe(400);
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("requires the separate publish grant for public publication", async () => {
    mocks.getApiAccess.mockResolvedValueOnce({ staff, response: null }).mockResolvedValueOnce({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const { PUT } = await import("./route");
    const response = await PUT(request({ slug: "home", action: "PUBLISH", expectedVersion: 1 }));
    expect(response.status).toBe(403); expect(mocks.getApiAccess).toHaveBeenNthCalledWith(1, "website.content.manage"); expect(mocks.getApiAccess).toHaveBeenNthCalledWith(2, "website.content.publish"); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("requires independent review permission before a review decision reaches persistence", async () => {
    mocks.getApiAccess.mockResolvedValueOnce({ staff, response: null }).mockResolvedValueOnce({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const { PUT } = await import("./route");
    const response = await PUT(request({ slug: "home", action: "APPROVE_REVIEW", expectedVersion: 1, reason: "Synthetic review" }));
    expect(response.status).toBe(403); expect(mocks.getApiAccess).toHaveBeenNthCalledWith(2, "website.content.review"); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("requires a reason for editorial decisions", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff, response: null });
    const { PUT } = await import("./route");
    const response = await PUT(request({ slug: "home", action: "REQUEST_CHANGES", expectedVersion: 1 }));
    expect(response.status).toBe(400); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("returns authorized encrypted draft versions as structured content", async () => {
    const pageId = "33333333-3333-4333-8333-333333333333"; const content = { title: "Synthetic About", summary: "Synthetic", sections: [{ heading: "Visit", body: "Ask the team." }] };
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ admin_test: randomBytes(32).toString("base64") }); process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "admin_test";
    mocks.getApiAccess.mockResolvedValue({ staff, response: null });
    mocks.getDb.mockReturnValue({ execute: vi.fn().mockResolvedValueOnce({ rows: [{ id: pageId }] }).mockResolvedValueOnce({ rows: [{ version_number: 2, content_ciphertext: sealWebsiteContent(staff.organizationId, pageId, content), actor_staff_id: staff.staffUserId, recorded_at: new Date("2026-10-30T00:00:00Z") }] }) });
    const { GET } = await import("./route"); const response = await GET(new Request("http://localhost/api/admin/website-content?slug=about"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ versions: [{ version: 2, content, actorStaffId: staff.staffUserId, recordedAt: "2026-10-30T00:00:00.000Z" }], events: [] });
  });
});
