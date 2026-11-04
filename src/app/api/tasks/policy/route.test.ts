import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));
import { GET, PUT } from "./route";

describe("task approval policy API boundary", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("requires authenticated policy-management permission before reading configuration", async () => {
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await GET(new Request("http://localhost/api/tasks/policy"))).status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("tasks.policy.manage", undefined);
  });

  it("rejects unknown policy views without touching policy data", async () => {
    const response = await GET(new Request("http://localhost/api/tasks/policy?view=all-actions"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_view" });
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects malformed history cursors before authorization or database access", async () => {
    const response = await GET(new Request("http://localhost/api/tasks/policy?view=history&before=1%20OR%201%3D1"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_cursor" });
    const overflow = await GET(new Request("http://localhost/api/tasks/policy?view=history&before=9999999999999999999"));
    expect(overflow.status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns only authorized active scope rows, including unconfigured centres", async () => {
    const centreRows = [
      { id: "centre-a", code: "A", name: "Centre A" },
      { id: "centre-b", code: "B", name: "Centre B" },
    ];
    const policyRows = [
      { id: "org-policy", centreId: null, enabled: true, versionNumber: 1, escalationAfterMinutes: null, expireAfterMinutes: null, updatedAt: new Date("2026-01-01T00:00:00Z") },
      { id: "a-policy", centreId: "centre-a", enabled: false, versionNumber: 2, escalationAfterMinutes: 30, expireAfterMinutes: 120, updatedAt: new Date("2026-01-02T00:00:00Z") },
      { id: "b-policy", centreId: "centre-b", enabled: true, versionNumber: 1, escalationAfterMinutes: null, expireAfterMinutes: null, updatedAt: new Date("2026-01-03T00:00:00Z") },
    ];
    const centreQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(centreRows) };
    const policyQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(policyRows) };
    getDb.mockReturnValue({ select: vi.fn().mockReturnValueOnce(centreQuery).mockReturnValueOnce(policyQuery) });
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "tasks.policy.manage", centreId: "centre-a" }] }, response: null });
    const response = await GET(new Request("http://localhost/api/tasks/policy?view=directory"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.policies).toEqual([
      { id: "a-policy", centreId: "centre-a", centreName: "Centre A", centreCode: "A", actionType: "TASK_COMPLETION", enabled: false, configured: true, versionNumber: 2, escalationAfterMinutes: 30, expireAfterMinutes: 120, updatedAt: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(payload.policies.some((row: { centreId: string | null }) => row.centreId === "centre-b" || row.centreId === null)).toBe(false);
    expect(centreQuery.where).toHaveBeenCalled();
    expect(policyQuery.where).toHaveBeenCalled();
  });

  it("rejects other action types before authorization or mutation", async () => {
    const { PUT } = await import("./route");
    const request = new Request("http://localhost/api/tasks/policy", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId: null, actionType: "REFUND_APPROVAL", enabled: true, approverStaffIds: [], escalationAfterMinutes: null, escalationOwnerStaffId: null, expectedVersion: 0 }) });
    expect((await PUT(request)).status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
  });

  it("rejects cross-origin policy updates before authorization", async () => {
    const { PUT } = await import("./route");
    const request = new Request("http://localhost/api/tasks/policy", { method: "PUT", headers: { origin: "https://untrusted.invalid", "content-type": "application/json" }, body: "{}" });
    expect((await PUT(request)).status).toBe(403);
    expect(getApiAccess).not.toHaveBeenCalled();
  });

  it("rejects an organization-default policy read from a centre-only administrator", async () => {
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "tasks.policy.manage", centreId: "centre-a" }] }, response: null });
    const response = await GET(new Request("http://localhost/api/tasks/policy"));
    expect(response.status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("denies policy history for a different centre before querying", async () => {
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "tasks.policy.manage", centreId: "11111111-1111-4111-8111-111111111111" }] }, response: null });
    const response = await GET(new Request("http://localhost/api/tasks/policy?view=history&centreId=22222222-2222-4222-8222-222222222222"));
    expect(response.status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns scoped policy version snapshots with approver and escalation settings", async () => {
    const centreQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]) };
    const policyQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: "policy-a", centreId: "11111111-1111-4111-8111-111111111111" }]) };
    const historyQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([
      { sequence: "990", action: "staff_approval_policy.updated", actorStaffId: "staff-admin", recordedAt: new Date("2026-01-02T00:00:00Z"), details: { version: 3, enabled: true, approverStaffIds: ["staff-approver"], escalationAfterMinutes: 60, escalationOwnerStaffId: "staff-escalation", expireAfterMinutes: 240 } },
      { sequence: "980", action: "staff_approval_policy.updated", actorStaffId: "staff-admin", recordedAt: new Date("2026-01-01T00:00:00Z"), details: { version: 2, enabled: false, approverCount: 1 } },
    ]) };
    const staffQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([
      { id: "staff-admin", displayName: "Policy Manager", staffCode: "ADM-1" },
      { id: "staff-approver", displayName: "Task Approver", staffCode: "OPS-1" },
      { id: "staff-escalation", displayName: "Escalation Owner", staffCode: "OPS-2" },
    ]) };
    getDb.mockReturnValue({ select: vi.fn().mockReturnValueOnce(centreQuery).mockReturnValueOnce(policyQuery).mockReturnValueOnce(historyQuery).mockReturnValueOnce(staffQuery) });
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "tasks.policy.manage", centreId: "11111111-1111-4111-8111-111111111111" }] }, response: null });
    const response = await GET(new Request("http://localhost/api/tasks/policy?view=history&centreId=11111111-1111-4111-8111-111111111111"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ history: [
      { sequence: "990", action: "staff_approval_policy.updated", actorDisplayName: "Policy Manager (ADM-1)", recordedAt: "2026-01-02T00:00:00.000Z", snapshotComplete: true, version: 3, enabled: true, approverDisplayNames: ["Task Approver (OPS-1)"], escalationAfterMinutes: 60, escalationOwnerDisplayName: "Escalation Owner (OPS-2)", expireAfterMinutes: 240 },
      { sequence: "980", action: "staff_approval_policy.updated", actorDisplayName: "Policy Manager (ADM-1)", recordedAt: "2026-01-01T00:00:00.000Z", snapshotComplete: false, version: 2, enabled: false, approverDisplayNames: null, escalationAfterMinutes: null, escalationOwnerDisplayName: null, expireAfterMinutes: null },
    ], hasMore: false, nextBefore: null });
    expect(historyQuery.where).toHaveBeenCalled();
    expect(historyQuery.limit).toHaveBeenCalledWith(50);
  });

  it("returns a stable before cursor when more policy history remains", async () => {
    const policyQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: "policy-org" }]) };
    const rows = Array.from({ length: 50 }, (_, index) => ({ sequence: String(500 - index), action: "staff_approval_policy.updated", actorStaffId: "staff-admin", recordedAt: new Date("2026-01-02T00:00:00Z"), details: {} }));
    const historyQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(rows) };
    const staffQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    getDb.mockReturnValue({ select: vi.fn().mockReturnValueOnce(policyQuery).mockReturnValueOnce(historyQuery).mockReturnValueOnce(staffQuery) });
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "tasks.policy.manage", centreId: null }] }, response: null });
    const response = await GET(new Request("http://localhost/api/tasks/policy?view=history&before=501"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.history).toHaveLength(50);
    expect(payload.hasMore).toBe(true);
    expect(payload.nextBefore).toBe("451");
    expect(historyQuery.limit).toHaveBeenCalledWith(50);
  });

  it("reports an effective organization default to a centre policy manager without exposing approver identities", async () => {
    const centreId = "11111111-1111-4111-8111-111111111111";
    const centreQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: centreId }]) };
    const policyQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: "org-policy", centreId: null, enabled: true, versionNumber: 3, escalationAfterMinutes: 60, escalationOwnerStaffId: "restricted-approver", expireAfterMinutes: 240 }]) };
    const eligibleQuery = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    getDb.mockReturnValue({ select: vi.fn().mockReturnValueOnce(centreQuery).mockReturnValueOnce(policyQuery), selectDistinct: vi.fn().mockReturnValue(eligibleQuery) });
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "tasks.policy.manage", centreId }] }, response: null });
    const response = await GET(new Request(`http://localhost/api/tasks/policy?centreId=${centreId}`));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ policy: null, effectivePolicy: { source: "ORGANIZATION", enabled: true } });
    expect(JSON.stringify(payload)).not.toContain("restricted-approver");
  });

  it("rejects an update to the organization-default policy from a centre-only administrator", async () => {
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "tasks.policy.manage", centreId: "centre-a" }] }, response: null });
    const request = new Request("http://localhost/api/tasks/policy", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "11111111-1111-4111-8111-111111111111" }, body: JSON.stringify({ centreId: null, actionType: "TASK_COMPLETION", enabled: false, approverStaffIds: [], escalationAfterMinutes: null, escalationOwnerStaffId: null, expectedVersion: 0 }) });
    const response = await PUT(request);
    expect(response.status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("tasks.policy.manage", undefined);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects an approval expiry outside the supported policy bounds", async () => {
    const request = new Request("http://localhost/api/tasks/policy", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId: null, actionType: "TASK_COMPLETION", enabled: false, approverStaffIds: [], escalationAfterMinutes: null, escalationOwnerStaffId: null, expireAfterMinutes: 5, expectedVersion: 0 }) });
    const response = await PUT(request);
    expect(response.status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects an expiry deadline that would prevent the configured escalation from running", async () => {
    const request = new Request("http://localhost/api/tasks/policy", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "11111111-1111-4111-8111-111111111112" }, body: JSON.stringify({ centreId: null, actionType: "TASK_COMPLETION", enabled: false, approverStaffIds: [], escalationAfterMinutes: 60, escalationOwnerStaffId: "22222222-2222-4222-8222-222222222222", expireAfterMinutes: 45, expectedVersion: 0 }) });
    const response = await PUT(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_approval_policy", fields: ["expireAfterMinutes"] });
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires an idempotency key for a valid policy mutation before authorization or database access", async () => {
    const request = new Request("http://localhost/api/tasks/policy", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId: null, actionType: "TASK_COMPLETION", enabled: false, approverStaffIds: [], escalationAfterMinutes: null, escalationOwnerStaffId: null, expectedVersion: 0 }) });
    const response = await PUT(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "idempotency_key_required" });
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects duplicate approver selections before authorization or database writes", async () => {
    const staffId = "11111111-1111-4111-8111-111111111111";
    const request = new Request("http://localhost/api/tasks/policy", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId: null, actionType: "TASK_COMPLETION", enabled: true, approverStaffIds: [staffId, staffId], escalationAfterMinutes: null, escalationOwnerStaffId: null, expectedVersion: 0 }) });
    const response = await PUT(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_approval_policy", fields: ["approverStaffIds"] });
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });
});
