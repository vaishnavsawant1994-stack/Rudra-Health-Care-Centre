import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn(), appendAuditEvent: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

import { GET, PATCH, POST } from "./route";

const id = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";
const context = { params: Promise.resolve({ id }) };
describe("lead communication draft API authorization", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unsigned draft reads before touching the database", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/leads/x/communications"), context)).status).toBe(401);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("leads.read"); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects unsigned draft creation before touching the database", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await POST(new Request(`http://localhost/api/leads/${id}/communications`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), purpose: "OPERATIONAL", channel: "EMAIL", body: "Synthetic draft" }) }), context);
    expect(response.status).toBe(428); expect(mocks.getApiAccess).toHaveBeenCalledWith("leads.activities.write"); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("requires a versioned active template reference instead of accepting both template and manual text", async () => {
    const { POST } = await import("./route");
    const cases = [
      { idempotencyKey: crypto.randomUUID(), purpose: "OPERATIONAL", channel: "EMAIL", templateId: crypto.randomUUID() },
      { idempotencyKey: crypto.randomUUID(), purpose: "OPERATIONAL", channel: "EMAIL", templateId: crypto.randomUUID(), templateVersion: 1, body: "Manual override" },
    ];
    for (const value of cases) {
      const response = await POST(new Request(`http://localhost/api/leads/${id}/communications`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(value) }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.getApiAccess).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects cross-centre draft reads before loading private drafts", async () => {
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id, organizationId: "org-a", centreId: "centre-a" }] }) }) }));
    mocks.getDb.mockReturnValue({ select });
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "leads.read", centreId: "centre-b" }] }, response: null });
    const response = await GET(new Request(`http://localhost/api/leads/${id}/communications`), context);
    expect(response.status).toBe(404); expect(select).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-origin draft writes before authentication or persistence", async () => {
    const response = await POST(new Request(`http://localhost/api/leads/${id}/communications`, { method: "POST", headers: { origin: "https://not-localhost.invalid", "content-type": "application/json" }, body: "{}" }), context);
    expect(response.status).toBe(403); expect(mocks.getApiAccess).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated draft cancellation before touching the database", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await PATCH(new Request(`http://localhost/api/leads/${id}/communications`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ draftId: crypto.randomUUID(), action: "CANCEL", expectedUpdatedAt: new Date().toISOString() }) }), context);
    expect(response.status).toBe(428); expect(mocks.getApiAccess).toHaveBeenCalledWith("leads.activities.write"); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects cross-origin draft cancellation before authentication or persistence", async () => {
    const response = await PATCH(new Request(`http://localhost/api/leads/${id}/communications`, { method: "PATCH", headers: { origin: "https://not-localhost.invalid", "content-type": "application/json" }, body: "{}" }), context);
    expect(response.status).toBe(403); expect(mocks.getApiAccess).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("cancels a draft transactionally and appends a content-free event", async () => {
    const staffUserId = crypto.randomUUID(); const centreId = crypto.randomUUID(); const draftId = crypto.randomUUID();
    const updatedAt = new Date("2026-11-01T00:00:00.123Z"); const inserts: unknown[] = [];
    let selected = 0;
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => ++selected === 1
        ? [{ id, organizationId: "org-a", centreId }]
        : [{ id: draftId, organizationId: "org-a", centreId, leadId: id, status: "DRAFT", updatedAt }] }) }) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: draftId, status: "CANCELLED" }] }) }) }),
      insert: () => ({ values: async (value: unknown) => { inserts.push(value); } }),
    };
    mocks.getDb.mockReturnValue({ transaction: async (run: (value: typeof tx) => Promise<unknown>) => run(tx) });
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", staffUserId, grants: [{ key: "leads.activities.write", centreId }] }, response: null });
    const response = await PATCH(new Request(`http://localhost/api/leads/${id}/communications`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ draftId, action: "CANCEL", expectedUpdatedAt: updatedAt.toISOString() }) }), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ draft: { id: draftId, status: "CANCELLED", replayed: false } });
    expect(inserts).toEqual([{ organizationId: "org-a", centreId, draftId, actorStaffId: staffUserId, eventType: "CANCELLED" }]);
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "lead.communication_draft_cancelled", details: { draftId, status: "CANCELLED" } }));
  });
  it("rejects a stale draft version without updating or writing history", async () => {
    const centreId = crypto.randomUUID(); const draftId = crypto.randomUUID(); const updatedAt = new Date("2026-11-01T00:00:00.123Z");
    let selected = 0; const update = vi.fn(); const insert = vi.fn();
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => ++selected === 1
        ? [{ id, organizationId: "org-a", centreId }]
        : [{ id: draftId, organizationId: "org-a", centreId, leadId: id, status: "DRAFT", updatedAt }] }) }) }) }),
      update, insert,
    };
    mocks.getDb.mockReturnValue({ transaction: async (run: (value: typeof tx) => Promise<unknown>) => run(tx) });
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", staffUserId: crypto.randomUUID(), grants: [{ key: "leads.activities.write", centreId }] }, response: null });
    const response = await PATCH(new Request(`http://localhost/api/leads/${id}/communications`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ draftId, action: "CANCEL", expectedUpdatedAt: new Date(updatedAt.getTime() - 1).toISOString() }) }), context);
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "draft_conflict" });
    expect(update).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled(); expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
