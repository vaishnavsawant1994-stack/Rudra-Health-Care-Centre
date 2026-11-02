import { beforeEach, describe, expect, it, vi } from "vitest";
import { escalationRequestFingerprint } from "@/server/escalation-request-fingerprint";
import { GET as getEscalations } from "./route";

const { getApiAccess, getDb, resolveTaskReference } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn(), resolveTaskReference: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));
vi.mock("@/server/task-reference", () => ({ resolveTaskReference }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: vi.fn() }));
vi.mock("@/server/operational-crypto", () => ({ operationalContext: vi.fn(() => ({})), encryptOperationalData: vi.fn(() => "ciphertext"), decryptOperationalData: vi.fn(() => ({})) }));
vi.mock("@/server/csrf", () => ({ isSameOriginRequest: vi.fn(() => true), csrfRejected: vi.fn(() => Response.json({ error: "csrf" }, { status: 403 })) }));

describe("escalation source deduplication", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); resolveTaskReference.mockReset(); });

  it("rejects invalid escalation queue pages before authorization or database access", async () => {
    for (const page of ["0", "-1", "1.5", "100001", "not-a-page"]) {
      const response = await getEscalations(new Request(`http://localhost/api/escalations?page=${encodeURIComponent(page)}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_page" });
    }
    for (const [field, value, error] of [["severity", "CRITICAL", "invalid_severity"], ["priority", "CRITICAL", "invalid_priority"]]) {
      const response = await getEscalations(new Request(`http://localhost/api/escalations?${field}=${value}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error });
    }
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects escalation field updates with no change, an elapsed due time, or no reason", async () => {
    const { PATCH } = await import("./[id]/route");
    const id = "11111111-1111-4111-8111-111111111111";
    for (const payload of [
      { action: "UPDATE", expectedVersion: 1, reason: "Reviewed" },
      { action: "UPDATE", expectedVersion: 1, priority: "HIGH", reason: " " },
    ]) {
      const response = await PATCH(new Request(`http://localhost/api/escalations/${id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(payload) }), { params: Promise.resolve({ id }) });
      expect(response.status).toBe(400);
    }
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires an idempotency key for escalation mutations before database access", async () => {
    const { PATCH } = await import("./[id]/route");
    const id = "11111111-1111-4111-8111-111111111111";
    const response = await PATCH(new Request(`http://localhost/api/escalations/${id}`, {
      method: "PATCH",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ action: "ACKNOWLEDGE", expectedVersion: 1 }),
    }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "idempotency_key_required" });
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("accepts a lead-follow-up source and returns its existing open escalation instead of creating a duplicate", async () => {
    const idempotencyLookup = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    const priorEventLookup = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    const openSourceLookup = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), for: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: "55555555-5555-4555-8555-555555555555", escalationNumber: "RHC-E-2026-EXISTING" }]) };
    const insertedValues = vi.fn().mockResolvedValue(undefined);
    const tx = { execute: vi.fn().mockResolvedValue(undefined), select: vi.fn().mockReturnValueOnce(idempotencyLookup).mockReturnValueOnce(priorEventLookup).mockReturnValueOnce(openSourceLookup), insert: vi.fn(() => ({ values: insertedValues })) };
    const staffLookup = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]) };
    const db = { select: vi.fn(() => staffLookup), transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)) };
    getDb.mockReturnValue(db);
    getApiAccess.mockResolvedValue({ staff: { organizationId: "22222222-2222-4222-8222-222222222222", staffUserId: "11111111-1111-4111-8111-111111111111" }, response: null });
    resolveTaskReference.mockResolvedValue("Synthetic appointment");

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/escalations", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "33333333-3333-4333-8333-333333333333" },
      body: JSON.stringify({ centreId: "44444444-4444-4444-8444-444444444444", source: { type: "LEAD_FOLLOWUP", id: "66666666-6666-4666-8666-666666666666" }, title: "Review lead callback", description: "Synthetic CRM follow-up escalation", severity: "MODERATE", priority: "NORMAL", assignedOwnerStaffId: "11111111-1111-4111-8111-111111111111", dueAt: "2099-01-01T10:00:00.000Z", deduplicateOpenSource: true }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ escalation: { replayed: false, alreadyOpen: true } });
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(tx.insert).toHaveBeenCalledOnce();
    expect(insertedValues).toHaveBeenCalledWith(expect.objectContaining({ eventType: "DUPLICATE_SUPPRESSED", requestHash: expect.any(String), idempotencyKey: "33333333-3333-4333-8333-333333333333" }));
  });

  it("replays a prior duplicate-suppression receipt without querying the open source", async () => {
    const key = "33333333-3333-4333-8333-333333333333";
    const requestBody = { centreId: "44444444-4444-4444-8444-444444444444", source: { type: "LEAD_FOLLOWUP", id: "66666666-6666-4666-8666-666666666666" }, title: "Review lead callback", description: "Synthetic CRM follow-up escalation", severity: "MODERATE", priority: "NORMAL", assignedOwnerStaffId: "11111111-1111-4111-8111-111111111111", dueAt: "2099-01-01T10:00:00.000Z", deduplicateOpenSource: true };
    const idempotencyLookup = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    const priorEventLookup = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ escalationId: "55555555-5555-4555-8555-555555555555", centreId: requestBody.centreId, requestHash: escalationRequestFingerprint(requestBody), privateDataCiphertext: "ciphertext", eventId: "77777777-7777-4777-8777-777777777777" }]) };
    const tx = { execute: vi.fn(), select: vi.fn().mockReturnValueOnce(idempotencyLookup).mockReturnValueOnce(priorEventLookup), insert: vi.fn() };
    const staffLookup = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: requestBody.assignedOwnerStaffId }]) };
    getDb.mockReturnValue({ select: vi.fn(() => staffLookup), transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)) });
    getApiAccess.mockResolvedValue({ staff: { organizationId: "22222222-2222-4222-8222-222222222222", staffUserId: "11111111-1111-4111-8111-111111111111" }, response: null });
    resolveTaskReference.mockResolvedValue("Synthetic lead follow-up");
    const crypto = await import("@/server/operational-crypto");
    vi.mocked(crypto.decryptOperationalData).mockReturnValueOnce({ result: { alreadyOpen: true }, privateRequest: { title: requestBody.title, description: requestBody.description } } as never);

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/escalations", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(requestBody) }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ escalation: { replayed: true, alreadyOpen: true } });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(resolveTaskReference).toHaveBeenCalledOnce();
  });
});
