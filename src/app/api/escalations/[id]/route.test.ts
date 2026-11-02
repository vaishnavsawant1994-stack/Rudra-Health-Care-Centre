import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "./route";
import { escalationActionFingerprint } from "@/server/escalation-request-fingerprint";

const { getApiAccess, getDb, resolveTaskReference } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn(), resolveTaskReference: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));
vi.mock("@/server/task-reference", () => ({ resolveTaskReference }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: vi.fn() }));
vi.mock("@/server/operational-crypto", () => ({ operationalContext: vi.fn(() => ({})), encryptOperationalData: vi.fn(() => "ciphertext"), decryptOperationalData: vi.fn(() => ({})) }));
vi.mock("@/server/csrf", () => ({ isSameOriginRequest: vi.fn(() => true), csrfRejected: vi.fn(() => Response.json({ error: "csrf" }, { status: 403 })) }));

describe("assigned escalation detail access", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); resolveTaskReference.mockReset(); });

  it("allows the assigned-reader permission gate before resolving the centre-scoped record", async () => {
    const assignedReader = { staffUserId: "staff-a", organizationId: "org-a", grants: [{ key: "escalations.assigned.read", centreId: "centre-a" }] };
    getApiAccess
      .mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) })
      .mockResolvedValueOnce({ staff: assignedReader, response: null });
    const query = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    getDb.mockReturnValue({ select: vi.fn(() => query) });

    const id = "11111111-1111-4111-8111-111111111111";
    const response = await GET(new Request(`http://localhost/api/escalations/${id}`), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(404);
    expect(getApiAccess.mock.calls).toEqual([["escalations.read", undefined], ["escalations.assigned.read", undefined]]);
    expect(getDb).toHaveBeenCalledOnce();
    expect(resolveTaskReference).not.toHaveBeenCalled();
  });

  it("does not query escalation data when neither escalation read grant is present", async () => {
    const denied = Response.json({ error: "forbidden" }, { status: 403 });
    getApiAccess.mockResolvedValueOnce({ staff: null, response: denied }).mockResolvedValueOnce({ staff: null, response: denied });

    const id = "11111111-1111-4111-8111-111111111111";
    const response = await GET(new Request(`http://localhost/api/escalations/${id}`), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rechecks the requested action permission before returning an idempotent replay", async () => {
    const centreId = "22222222-2222-4222-8222-222222222222";
    const escalationId = "11111111-1111-4111-8111-111111111111";
    const requestBody = { action: "ACKNOWLEDGE", expectedVersion: 1 } as const;
    const requestHash = escalationActionFingerprint(escalationId, requestBody);
    const caller = { staffUserId: "reader-only", organizationId: "org-a", grants: [{ key: "escalations.read", centreId }] };
    getApiAccess.mockResolvedValue({ staff: caller, response: null });
    const rowQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), for: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{
      id: escalationId, organizationId: "org-a", centreId, assignedOwnerStaffId: "assigned-owner", status: "ACKNOWLEDGED", versionNumber: 2, privateDataCiphertext: "ciphertext",
    }]) };
    const replayQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{
      escalationId, centreId, requestHash, privateDataCiphertext: "ciphertext", eventId: "33333333-3333-4333-8333-333333333333",
    }]) };
    const tx = { execute: vi.fn().mockResolvedValue(undefined), select: vi.fn().mockReturnValueOnce(rowQuery).mockReturnValueOnce(replayQuery) };
    getDb.mockReturnValue({ transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    const crypto = await import("@/server/operational-crypto");
    vi.mocked(crypto.decryptOperationalData).mockReset();
    vi.mocked(crypto.decryptOperationalData).mockReturnValueOnce({ result: { status: "ACKNOWLEDGED", versionNumber: 2 } } as never);

    const request = new Request(`http://localhost/api/escalations/${escalationId}`, {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "44444444-4444-4444-8444-444444444444" },
      body: JSON.stringify(requestBody),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: escalationId }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(crypto.decryptOperationalData).not.toHaveBeenCalled();
    expect(tx.select).toHaveBeenCalledOnce();
  });

  it("preserves an authorized manager's idempotent escalation replay", async () => {
    const centreId = "22222222-2222-4222-8222-222222222222";
    const escalationId = "11111111-1111-4111-8111-111111111111";
    const requestBody = { action: "UPDATE", expectedVersion: 1, severity: "HIGH", reason: "Synthetic review" } as const;
    const requestHash = escalationActionFingerprint(escalationId, requestBody);
    const manager = { staffUserId: "manager-1", organizationId: "org-a", grants: [
      { key: "escalations.read", centreId }, { key: "escalations.manage", centreId },
    ] };
    getApiAccess.mockResolvedValue({ staff: manager, response: null });
    const rowQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), for: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{
      id: escalationId, organizationId: "org-a", centreId, assignedOwnerStaffId: "assigned-owner", status: "OPEN", versionNumber: 2, privateDataCiphertext: "ciphertext",
    }]) };
    const replayQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{
      escalationId, centreId, requestHash, privateDataCiphertext: "ciphertext", eventId: "33333333-3333-4333-8333-333333333333",
    }]) };
    const update = vi.fn();
    const tx = { execute: vi.fn().mockResolvedValue(undefined), select: vi.fn().mockReturnValueOnce(rowQuery).mockReturnValueOnce(replayQuery), update };
    getDb.mockReturnValue({ transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    const crypto = await import("@/server/operational-crypto");
    vi.mocked(crypto.decryptOperationalData).mockReset();
    vi.mocked(crypto.decryptOperationalData).mockReturnValueOnce({ reason: requestBody.reason, comment: null, result: { status: "OPEN", versionNumber: 2 } } as never);

    const request = new Request(`http://localhost/api/escalations/${escalationId}`, {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "44444444-4444-4444-8444-444444444444" },
      body: JSON.stringify(requestBody),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: escalationId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ escalation: { id: escalationId, status: "OPEN", versionNumber: 2, replayed: true } });
    expect(update).not.toHaveBeenCalled();
  });
});
