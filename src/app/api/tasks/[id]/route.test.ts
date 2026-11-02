import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: vi.fn().mockResolvedValue(undefined) }));

const taskId = "aa000000-0000-4000-8000-000000000001";
const taskParams = { params: Promise.resolve({ id: taskId }) };
const patchRequest = (body: unknown, origin = "http://localhost") => new Request(`http://localhost/api/tasks/${taskId}`, {
  method: "PATCH",
  headers: { origin, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
  body: JSON.stringify(body),
});

describe("staff task detail authorization boundary", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });
  afterEach(() => { delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; });

  it("rejects unauthenticated or MFA-incomplete task mutations before database access", async () => {
    const { PATCH } = await import("./route");
    const denied = Response.json({ error: "mfa_required" }, { status: 403 });
    getApiAccess.mockResolvedValue({ staff: null, response: denied });

    const response = await PATCH(patchRequest({ expectedVersion: 1, action: "START" }), taskParams);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "mfa_required" });
    expect(getApiAccess).toHaveBeenCalledWith("workspace.read");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires an idempotency key for every task mutation", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/tasks/${taskId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 1, action: "START" }) }), taskParams);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "idempotency_key_required" });
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects cross-origin task mutations before session or database access", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(patchRequest({ expectedVersion: 1, action: "START" }, "https://untrusted.invalid"), taskParams);

    expect(response.status).toBe(403);
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a task update without an authenticated session before reading any task", async () => {
    const { PATCH } = await import("./route");
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "unauthorized" }, { status: 401 }) });

    const response = await PATCH(patchRequest({ expectedVersion: 1, action: "START" }), taskParams);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects malformed actions before access checks or database reads", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(patchRequest({ expectedVersion: 1, action: "APPROVE_REFUND" }), taskParams);

    expect(response.status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires a reason before reopening a task", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(patchRequest({ expectedVersion: 4, action: "REOPEN" }), taskParams);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_task_action" });
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("conceals malformed or unknown task identifiers", async () => {
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost/api/tasks/not-a-uuid"), { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("allows an assigned-only reader to open their task detail through the protected task API", async () => {
    const { GET } = await import("./route");
    const organizationId = "ba000000-0000-4000-8000-000000000001";
    const centreId = "ba000000-0000-4000-8000-000000000002";
    const assignedStaffId = "ba000000-0000-4000-8000-000000000003";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 15).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, taskNumber: "RHC-T-ASSIGNED-ONLY", taskType: "GENERAL", priority: "NORMAL",
      status: "OPEN", approvalStatus: "NOT_REQUIRED", approvalPolicyId: null, approvalExpiresAt: null,
      escalationOwnerStaffId: null, escalationDueAt: null, escalationProcessedAt: null, assignedStaffId: assignedStaffId,
      assignedStaffName: "Synthetic Assigned Staff", createdByStaffId: "ba000000-0000-4000-8000-000000000004", dueAt: null,
      versionNumber: 1, requiresApproval: false, createdAt: new Date("2026-10-31T00:00:00Z"), updatedAt: new Date("2026-10-31T00:00:00Z"),
      privateDataCiphertext: encryptOperationalData({ title: "Synthetic assigned task", description: "Only assigned reader may see this detail" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const lookup = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([task]) };
    const history = { from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue([]) };
    getDb.mockReturnValue({ select: vi.fn().mockReturnValueOnce(lookup).mockReturnValueOnce(history) });
    getApiAccess.mockImplementation(async () => ({ staff: { organizationId, staffUserId: assignedStaffId, grants: [{ key: "tasks.assigned.read", centreId }] }, response: null }));

    const response = await GET(new Request(`http://localhost/api/tasks/${taskId}`), taskParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task).toMatchObject({ id: taskId, title: "Synthetic assigned task", description: "Only assigned reader may see this detail" });
    expect(body).not.toHaveProperty("escalationApprovers");
  });

  it("does not disclose frozen approval-policy identifiers in readable task history", async () => {
    const { GET } = await import("./route");
    const organizationId = "bf000000-0000-4000-8000-000000000001";
    const centreId = "bf000000-0000-4000-8000-000000000002";
    const readerId = "bf000000-0000-4000-8000-000000000003";
    const assignedId = "bf000000-0000-4000-8000-000000000004";
    const eventId = "bf000000-0000-4000-8000-000000000005";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 11).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, taskNumber: "RHC-T-SNAPSHOT-READ", taskType: "GENERAL", priority: "NORMAL",
      status: "AWAITING_APPROVAL", approvalStatus: "PENDING", approvalPolicyId: "policy-private-id", approvalExpiresAt: null,
      escalationOwnerStaffId: null, escalationDueAt: null, escalationProcessedAt: null, assignedStaffId: assignedId,
      assignedStaffName: "Synthetic Assignee", createdByStaffId: readerId, dueAt: null, versionNumber: 2, requiresApproval: true,
      createdAt: new Date("2026-10-30T00:00:00Z"), updatedAt: new Date("2026-10-30T00:00:00Z"),
      privateDataCiphertext: encryptOperationalData({ title: "Synthetic task", description: "No policy ids in response" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const event = {
      id: eventId, eventType: "SUBMITTED_FOR_APPROVAL", actorType: "STAFF", actorStaffId: readerId, actorName: "Synthetic Reader", recordedAt: new Date("2026-10-30T00:00:00Z"),
      privateDataCiphertext: encryptOperationalData({ reason: "Ready for review", approvalSnapshotVersion: 1, approvalPolicyId: "policy-private-id", approvalPolicyVersion: 4, approvalApproverStaffIds: ["private-staff-id"] }, operationalContext({ organizationId, centreId, recordId: eventId }, "staff-task-event")),
    };
    const lookup = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([task]) };
    const history = { from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue([event]) };
    getDb.mockReturnValue({ select: vi.fn().mockReturnValueOnce(lookup).mockReturnValueOnce(history) });
    getApiAccess.mockImplementation(async (_permission: string) => ({ staff: { organizationId, staffUserId: readerId, grants: [{ key: "tasks.read", centreId }] }, response: null }));

    const response = await GET(new Request(`http://localhost/api/tasks/${taskId}`), taskParams);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.history[0]).toMatchObject({ reason: "Ready for review", eventType: "SUBMITTED_FOR_APPROVAL" });
    expect(body.history[0]).not.toHaveProperty("approvalPolicyId");
    expect(body.history[0]).not.toHaveProperty("approvalPolicyVersion");
    expect(body.history[0]).not.toHaveProperty("approvalApproverStaffIds");
  });

  it("returns only currently eligible members of the frozen approver set for escalation reassignment", async () => {
    const { GET } = await import("./route");
    const organizationId = "b8000000-0000-4000-8000-000000000001";
    const centreId = "b8000000-0000-4000-8000-000000000002";
    const managerId = "b8000000-0000-4000-8000-000000000003";
    const creatorId = "b8000000-0000-4000-8000-000000000004";
    const assigneeId = "b8000000-0000-4000-8000-000000000005";
    const frozenApproverId = "b8000000-0000-4000-8000-000000000006";
    const newlyAddedApproverId = "b8000000-0000-4000-8000-000000000007";
    const eventId = "b8000000-0000-4000-8000-000000000008";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 13).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, taskNumber: "RHC-T-SNAPSHOT-OPTIONS", taskType: "GENERAL", priority: "NORMAL",
      status: "AWAITING_APPROVAL", approvalStatus: "PENDING", approvalPolicyId: "policy-private-id", approvalExpiresAt: null,
      escalationOwnerStaffId: managerId, escalationDueAt: new Date("2026-11-01T12:00:00Z"), escalationProcessedAt: null,
      assignedStaffId: assigneeId, assignedStaffName: "Synthetic Assignee", createdByStaffId: creatorId, dueAt: null,
      versionNumber: 2, requiresApproval: true, createdAt: new Date("2026-10-30T00:00:00Z"), updatedAt: new Date("2026-10-30T00:00:00Z"),
      privateDataCiphertext: encryptOperationalData({ title: "Synthetic pending task", description: "Approver options" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const event = {
      id: eventId, eventType: "SUBMITTED_FOR_APPROVAL", actorType: "STAFF", actorStaffId: creatorId, actorName: "Synthetic Creator", recordedAt: new Date("2026-10-30T00:00:00Z"),
      privateDataCiphertext: encryptOperationalData({ approvalSnapshotVersion: 1, approvalPolicyId: "policy-private-id", approvalPolicyVersion: 1, approvalApproverStaffIds: [frozenApproverId] }, operationalContext({ organizationId, centreId, recordId: eventId }, "staff-task-event")),
    };
    const lookup = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([task]) };
    const history = { from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue([event]) };
    const eligibleRows = [
      { id: frozenApproverId, displayName: "Frozen Approver", staffCode: "SYN-006" },
      { id: newlyAddedApproverId, displayName: "Added After Submission", staffCode: "SYN-007" },
      { id: creatorId, displayName: "Task Creator", staffCode: "SYN-004" },
      { id: assigneeId, displayName: "Task Assignee", staffCode: "SYN-005" },
    ];
    const eligibleQuery = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(eligibleRows) };
    const selectDistinct = vi.fn().mockReturnValue(eligibleQuery);
    getDb.mockReturnValue({ select: vi.fn().mockReturnValueOnce(lookup).mockReturnValueOnce(history), selectDistinct });
    getApiAccess.mockImplementation(async () => ({ staff: { organizationId, staffUserId: managerId, grants: [
      { key: "tasks.read", centreId }, { key: "tasks.assign", centreId }, { key: "tasks.approve", centreId },
    ] }, response: null }));

    const response = await GET(new Request(`http://localhost/api/tasks/${taskId}`), taskParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task.escalationApprovers).toEqual([{ id: frozenApproverId, displayName: "Frozen Approver", staffCode: "SYN-006" }]);
    expect(selectDistinct).toHaveBeenCalledOnce();
  });

  it("fails closed when a pending approval submission snapshot cannot be decrypted", async () => {
    const { GET } = await import("./route");
    const organizationId = "b9000000-0000-4000-8000-000000000001";
    const centreId = "b9000000-0000-4000-8000-000000000002";
    const managerId = "b9000000-0000-4000-8000-000000000003";
    const eventId = "b9000000-0000-4000-8000-000000000004";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 14).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, taskNumber: "RHC-T-SNAPSHOT-FAIL-CLOSED", taskType: "GENERAL", priority: "NORMAL",
      status: "AWAITING_APPROVAL", approvalStatus: "PENDING", approvalPolicyId: "policy-private-id", approvalExpiresAt: null,
      escalationOwnerStaffId: managerId, escalationDueAt: new Date("2026-11-01T12:00:00Z"), escalationProcessedAt: null,
      assignedStaffId: "b9000000-0000-4000-8000-000000000005", assignedStaffName: "Synthetic Assignee", createdByStaffId: "b9000000-0000-4000-8000-000000000006", dueAt: null,
      versionNumber: 2, requiresApproval: true, createdAt: new Date("2026-10-30T00:00:00Z"), updatedAt: new Date("2026-10-30T00:00:00Z"),
      privateDataCiphertext: encryptOperationalData({ title: "Synthetic pending task", description: "Fail-closed options" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const event = { id: eventId, eventType: "SUBMITTED_FOR_APPROVAL", actorType: "STAFF", actorStaffId: task.createdByStaffId, actorName: "Synthetic Creator", recordedAt: new Date("2026-10-30T00:00:00Z"), privateDataCiphertext: encryptOperationalData({ approvalSnapshotVersion: 99, approvalPolicyId: "policy-private-id", approvalPolicyVersion: 1, approvalApproverStaffIds: [] }, operationalContext({ organizationId, centreId, recordId: eventId }, "staff-task-event")) };
    const lookup = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([task]) };
    const history = { from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue([event]) };
    const selectDistinct = vi.fn();
    getDb.mockReturnValue({ select: vi.fn().mockReturnValueOnce(lookup).mockReturnValueOnce(history), selectDistinct });
    getApiAccess.mockImplementation(async () => ({ staff: { organizationId, staffUserId: managerId, grants: [
      { key: "tasks.read", centreId }, { key: "tasks.assign", centreId }, { key: "tasks.approve", centreId },
    ] }, response: null }));

    const response = await GET(new Request(`http://localhost/api/tasks/${taskId}`), taskParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task.escalationApprovers).toEqual([]);
    expect(selectDistinct).not.toHaveBeenCalled();
  });

  it("rejects reassigning an overdue escalation to the task creator or assignee", async () => {
    const { PATCH } = await import("./route");
    const organizationId = "bb000000-0000-4000-8000-000000000001";
    const centreId = "bb000000-0000-4000-8000-000000000002";
    const creatorId = "bb000000-0000-4000-8000-000000000003";
    const assigneeId = "bb000000-0000-4000-8000-000000000004";
    const actorId = "bb000000-0000-4000-8000-000000000005";
    const policyId = "bb000000-0000-4000-8000-000000000006";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 7).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, status: "AWAITING_APPROVAL", approvalStatus: "PENDING", taskType: "GENERAL",
      assignedStaffId: assigneeId, createdByStaffId: creatorId, approvalPolicyId: policyId, requiresApproval: true,
      escalationOwnerStaffId: actorId, escalationDueAt: new Date(Date.now() - 60_000), escalationProcessedAt: null,
      versionNumber: 3, privateDataCiphertext: encryptOperationalData({ title: "Synthetic escalation", description: "Test route guard" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const policy = { id: policyId, organizationId, actionType: "TASK_COMPLETION", enabled: true };
    const submissionId = "bb000000-0000-4000-8000-000000000009";
    const submission = { id: submissionId, privateDataCiphertext: encryptOperationalData({ approvalSnapshotVersion: 1, approvalPolicyId: policyId, approvalPolicyVersion: 1, approvalApproverStaffIds: [actorId] }, operationalContext({ organizationId, centreId, recordId: submissionId }, "staff-task-event")) };
    const results: unknown[][] = [[], [task], [policy], [submission], [], [{ id: assigneeId }]];
    const select = vi.fn(() => {
      const value = results.shift();
      const query: Record<string, ReturnType<typeof vi.fn>> = {};
      query.from = vi.fn(() => query); query.innerJoin = vi.fn(() => query); query.where = vi.fn(() => query); query.for = vi.fn(() => query); query.orderBy = vi.fn(() => query);
      query.limit = vi.fn(async () => value ?? []);
      query.then = vi.fn((resolve: (rows: unknown[]) => unknown) => Promise.resolve(value ?? []).then(resolve));
      return query;
    });
    const tx = { select, execute: vi.fn(), update: vi.fn(), insert: vi.fn() };
    getDb.mockReturnValue({ transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx) });
    getApiAccess.mockImplementation(async (permission: string) => ({
      staff: { organizationId, staffUserId: actorId, grants: [{ key: permission, centreId }] }, response: null,
    }));
    const response = await PATCH(patchRequest({
      expectedVersion: 3, action: "REASSIGN_ESCALATION", escalationOwnerStaffId: assigneeId,
      escalationDueAt: new Date(Date.now() + 60_000).toISOString(), reason: "Keep review independent",
    }), taskParams);
    expect(await response.json()).toEqual({ error: "escalation_owner_conflict" });
    expect(response.status).toBe(409);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("lets a scoped supervisor reassign a pending approval escalation before its current deadline", async () => {
    const { PATCH } = await import("./route");
    const organizationId = "bd000000-0000-4000-8000-000000000001";
    const centreId = "bd000000-0000-4000-8000-000000000002";
    const creatorId = "bd000000-0000-4000-8000-000000000003";
    const assigneeId = "bd000000-0000-4000-8000-000000000004";
    const actorId = "bd000000-0000-4000-8000-000000000005";
    const oldOwnerId = "bd000000-0000-4000-8000-000000000006";
    const nextOwnerId = "bd000000-0000-4000-8000-000000000007";
    const policyId = "bd000000-0000-4000-8000-000000000008";
    const submissionEventId = "bd000000-0000-4000-8000-000000000009";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 9).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, status: "AWAITING_APPROVAL", approvalStatus: "PENDING", taskType: "GENERAL",
      assignedStaffId: assigneeId, createdByStaffId: creatorId, approvalPolicyId: policyId, requiresApproval: true,
      escalationOwnerStaffId: oldOwnerId, escalationDueAt: new Date(Date.now() + 60 * 60_000), escalationProcessedAt: null,
      versionNumber: 3, privateDataCiphertext: encryptOperationalData({ title: "Synthetic escalation", description: "Owner unavailable" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const policy = { id: policyId, organizationId, actionType: "TASK_COMPLETION", enabled: true };
    const submission = {
      id: submissionEventId,
      privateDataCiphertext: encryptOperationalData({ approvalSnapshotVersion: 1, approvalPolicyId: policyId, approvalPolicyVersion: 2, approvalApproverStaffIds: [actorId, nextOwnerId] }, operationalContext({ organizationId, centreId, recordId: submissionEventId }, "staff-task-event")),
    };
    const results: unknown[][] = [[], [task], [policy], [submission], [], [{ id: nextOwnerId }]];
    const select = vi.fn(() => {
      const value = results.shift();
      const query: Record<string, ReturnType<typeof vi.fn>> = {};
      query.from = vi.fn(() => query); query.innerJoin = vi.fn(() => query); query.where = vi.fn(() => query); query.for = vi.fn(() => query); query.orderBy = vi.fn(() => query);
      query.limit = vi.fn(async () => value ?? []);
      query.then = vi.fn((resolve: (rows: unknown[]) => unknown) => Promise.resolve(value ?? []).then(resolve));
      return query;
    });
    const updated = { id: taskId, versionNumber: 4, status: "AWAITING_APPROVAL", approvalStatus: "PENDING" };
    const returning = vi.fn().mockResolvedValue([updated]);
    const set = vi.fn(() => ({ where: vi.fn(() => ({ returning })) }));
    const eventValues = vi.fn().mockResolvedValue(undefined);
    const tx = { select, execute: vi.fn(), update: vi.fn(() => ({ set })), insert: vi.fn(() => ({ values: eventValues })) };
    getDb.mockReturnValue({ transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx) });
    getApiAccess.mockImplementation(async (_permission: string) => ({ staff: { organizationId, staffUserId: actorId, grants: [{ key: "tasks.read", centreId }, { key: "tasks.assign", centreId }, { key: "tasks.approve", centreId }] }, response: null }));
    const newDueAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

    const response = await PATCH(patchRequest({
      expectedVersion: 3, action: "REASSIGN_ESCALATION", escalationOwnerStaffId: nextOwnerId,
      escalationDueAt: newDueAt, reason: "Current approver is unavailable",
    }), taskParams);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ task: updated, replayed: false });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ escalationOwnerStaffId: nextOwnerId, escalationDueAt: new Date(newDueAt), escalationProcessedAt: null, versionNumber: 4 }));
    const savedEvent = eventValues.mock.calls[0]?.[0] as { eventType: string; privateDataCiphertext: string; id: string };
    expect(savedEvent.eventType).toBe("ESCALATION_REASSIGNED");
    expect(decryptOperationalData<Record<string, unknown>>(savedEvent.privateDataCiphertext, operationalContext({ organizationId, centreId, recordId: savedEvent.id }, "staff-task-event"))).toMatchObject({ escalationOwnerStaffId: nextOwnerId, escalationDueAt: newDueAt, reason: "Current approver is unavailable" });
  });

  it("records an authorized due task escalation in the transactional event history", async () => {
    const { PATCH } = await import("./route");
    const organizationId = "bc000000-0000-4000-8000-000000000001";
    const centreId = "bc000000-0000-4000-8000-000000000002";
    const creatorId = "bc000000-0000-4000-8000-000000000003";
    const assigneeId = "bc000000-0000-4000-8000-000000000004";
    const actorId = "bc000000-0000-4000-8000-000000000005";
    const policyId = "bc000000-0000-4000-8000-000000000006";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 8).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, taskNumber: "RHC-T-SYNTHETIC", taskType: "GENERAL", priority: "NORMAL",
      status: "AWAITING_APPROVAL", approvalStatus: "PENDING", approvalPolicyId: policyId, requiresApproval: true,
      escalationOwnerStaffId: actorId, escalationDueAt: new Date(Date.now() - 60_000), escalationProcessedAt: null,
      assignedStaffId: assigneeId, createdByStaffId: creatorId, versionNumber: 3,
      privateDataCiphertext: encryptOperationalData({ title: "Synthetic due approval", description: "Escalation event regression" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const policy = { id: policyId, organizationId, actionType: "TASK_COMPLETION", enabled: true, escalationAfterMinutes: 30, escalationOwnerStaffId: actorId };
    const results: unknown[][] = [[], [task], [policy], [{ id: actorId }]];
    const select = vi.fn(() => {
      const value = results.shift();
      const query: Record<string, ReturnType<typeof vi.fn>> = {};
      query.from = vi.fn(() => query); query.innerJoin = vi.fn(() => query); query.where = vi.fn(() => query); query.for = vi.fn(() => query);
      query.orderBy = vi.fn(() => query); query.limit = vi.fn(async () => value ?? []);
      query.then = vi.fn((resolve: (rows: unknown[]) => unknown) => Promise.resolve(value ?? []).then(resolve));
      return query;
    });
    const eventValues = vi.fn().mockResolvedValue(undefined);
    const returning = vi.fn(async () => [{ id: taskId, versionNumber: 4, status: "AWAITING_APPROVAL", approvalStatus: "PENDING" }]);
    const tx = {
      select,
      execute: vi.fn(),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })) })),
      insert: vi.fn(() => ({ values: eventValues })),
    };
    getDb.mockReturnValue({ transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx) });
    getApiAccess.mockImplementation(async (permission: string) => ({ staff: { organizationId, staffUserId: actorId, grants: [{ key: permission, centreId }] }, response: null }));

    const response = await PATCH(patchRequest({ expectedVersion: 3, action: "TRIGGER_ESCALATION" }), taskParams);

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(responseBody).toMatchObject({ task: { id: taskId, versionNumber: 4, status: "AWAITING_APPROVAL" } });
    expect(tx.update).toHaveBeenCalledOnce();
    expect(eventValues).toHaveBeenCalledWith(expect.objectContaining({ eventType: "ESCALATED", taskId, organizationId, centreId, actorStaffId: actorId }));
  });

  it("uses the immutable submission approver snapshot after a policy edit", async () => {
    const { PATCH } = await import("./route");
    const organizationId = "be000000-0000-4000-8000-000000000001";
    const centreId = "be000000-0000-4000-8000-000000000002";
    const creatorId = "be000000-0000-4000-8000-000000000003";
    const assigneeId = "be000000-0000-4000-8000-000000000004";
    const approverId = "be000000-0000-4000-8000-000000000005";
    const policyId = "be000000-0000-4000-8000-000000000006";
    const eventId = "be000000-0000-4000-8000-000000000007";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 10).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, taskNumber: "RHC-T-SNAPSHOT", taskType: "GENERAL", priority: "NORMAL",
      status: "AWAITING_APPROVAL", approvalStatus: "PENDING", approvalPolicyId: policyId, approvalExpiresAt: null, requiresApproval: true,
      escalationOwnerStaffId: null, escalationDueAt: null, escalationProcessedAt: null, assignedStaffId: assigneeId,
      createdByStaffId: creatorId, versionNumber: 1,
      privateDataCiphertext: encryptOperationalData({ title: "Synthetic policy snapshot", description: "Approver set must remain stable" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const policy = { id: policyId, organizationId, actionType: "TASK_COMPLETION", enabled: false, versionNumber: 5 };
    const submissionEvent = {
      id: eventId,
      privateDataCiphertext: encryptOperationalData({ approvalSnapshotVersion: 1, approvalPolicyId: policyId, approvalPolicyVersion: 3, approvalApproverStaffIds: [approverId] }, operationalContext({ organizationId, centreId, recordId: eventId }, "staff-task-event")),
    };
    const results: unknown[][] = [[], [task], [policy], [submissionEvent], []];
    const select = vi.fn(() => {
      const value = results.shift();
      const query: Record<string, ReturnType<typeof vi.fn>> = {};
      query.from = vi.fn(() => query); query.innerJoin = vi.fn(() => query); query.where = vi.fn(() => query); query.for = vi.fn(() => query);
      query.orderBy = vi.fn(() => query); query.limit = vi.fn(async () => value ?? []);
      query.then = vi.fn((resolve: (rows: unknown[]) => unknown) => Promise.resolve(value ?? []).then(resolve));
      return query;
    });
    const eventValues = vi.fn().mockResolvedValue(undefined);
    const returning = vi.fn(async () => [{ id: taskId, versionNumber: 2, status: "COMPLETED", approvalStatus: "APPROVED" }]);
    const tx = { select, execute: vi.fn(), update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })) })), insert: vi.fn(() => ({ values: eventValues })) };
    getDb.mockReturnValue({ transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx) });
    getApiAccess.mockImplementation(async (permission: string) => ({ staff: { organizationId, staffUserId: approverId, grants: [{ key: permission, centreId }] }, response: null }));

    const response = await PATCH(patchRequest({ expectedVersion: 1, action: "APPROVE", reason: "Reviewed against submitted request" }), taskParams);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ task: { id: taskId, status: "COMPLETED", approvalStatus: "APPROVED" } });
    expect(select).toHaveBeenCalledTimes(5);
    expect(eventValues).toHaveBeenCalledWith(expect.objectContaining({ eventType: "APPROVED", taskId, organizationId, centreId, actorStaffId: approverId }));
  });

  it("uses the current effective policy when a rejected task is resubmitted", async () => {
    const { PATCH } = await import("./route");
    const organizationId = "c1000000-0000-4000-8000-000000000001";
    const centreId = "c1000000-0000-4000-8000-000000000002";
    const creatorId = "c1000000-0000-4000-8000-000000000003";
    const assigneeId = "c1000000-0000-4000-8000-000000000004";
    const newApproverId = "c1000000-0000-4000-8000-000000000005";
    const oldPolicyId = "c1000000-0000-4000-8000-000000000006";
    const currentPolicyId = "c1000000-0000-4000-8000-000000000007";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 12).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, taskNumber: "RHC-T-RESUBMIT", taskType: "GENERAL", priority: "NORMAL",
      status: "IN_PROGRESS", approvalStatus: "CHANGES_REQUESTED", approvalPolicyId: oldPolicyId, approvalExpiresAt: null,
      escalationOwnerStaffId: null, escalationDueAt: null, escalationProcessedAt: null, assignedStaffId: assigneeId,
      createdByStaffId: creatorId, versionNumber: 2, requiresApproval: true,
      privateDataCiphertext: encryptOperationalData({ title: "Synthetic resubmission", description: "Use the current centre policy" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const currentPolicy = { id: currentPolicyId, organizationId, centreId, actionType: "TASK_COMPLETION", enabled: true, versionNumber: 7, escalationAfterMinutes: null, escalationOwnerStaffId: null, expireAfterMinutes: 120 };
    const results: unknown[][] = [[], [task], [currentPolicy], [{ staffId: creatorId }, { staffId: assigneeId }, { staffId: newApproverId }], [{ id: creatorId }, { id: assigneeId }, { id: newApproverId }]];
    const select = vi.fn(() => {
      const value = results.shift();
      const query: Record<string, ReturnType<typeof vi.fn>> = {};
      query.from = vi.fn(() => query); query.innerJoin = vi.fn(() => query); query.where = vi.fn(() => query); query.for = vi.fn(() => query);
      query.orderBy = vi.fn(() => query); query.limit = vi.fn(async () => value ?? []);
      query.then = vi.fn((resolve: (rows: unknown[]) => unknown) => Promise.resolve(value ?? []).then(resolve));
      return query;
    });
    const eventValues = vi.fn().mockResolvedValue(undefined);
    const returning = vi.fn(async () => [{ id: taskId, versionNumber: 3, status: "AWAITING_APPROVAL", approvalStatus: "PENDING" }]);
    const updateSet = vi.fn(() => ({ where: vi.fn(() => ({ returning })) }));
    const tx = { select, execute: vi.fn(), update: vi.fn(() => ({ set: updateSet })), insert: vi.fn(() => ({ values: eventValues })) };
    getDb.mockReturnValue({ transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx) });
    getApiAccess.mockImplementation(async () => ({ staff: { organizationId, staffUserId: assigneeId, grants: ["workspace.read", "tasks.read", "tasks.assigned.read", "tasks.update"].map((key) => ({ key, centreId })) }, response: null }));

    const response = await PATCH(patchRequest({ expectedVersion: 2, action: "SUBMIT_APPROVAL" }), taskParams);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(select).toHaveBeenCalledTimes(5);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ approvalPolicyId: currentPolicyId, approvalExpiresAt: expect.any(Date) }));
    const savedEvent = eventValues.mock.calls[0][0] as { id: string; privateDataCiphertext: string };
    expect(decryptOperationalData<Record<string, unknown>>(savedEvent.privateDataCiphertext, operationalContext({ organizationId, centreId, recordId: savedEvent.id }, "staff-task-event"))).toMatchObject({ approvalSnapshotVersion: 1, approvalPolicyId: currentPolicyId, approvalPolicyVersion: 7, approvalApproverStaffIds: [newApproverId] });
  });

  it("records due approval expiry with an independent authorized approver", async () => {
    const { PATCH } = await import("./route");
    const organizationId = "bd000000-0000-4000-8000-000000000001";
    const centreId = "bd000000-0000-4000-8000-000000000002";
    const creatorId = "bd000000-0000-4000-8000-000000000003";
    const assigneeId = "bd000000-0000-4000-8000-000000000004";
    const actorId = "bd000000-0000-4000-8000-000000000005";
    const policyId = "bd000000-0000-4000-8000-000000000006";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 9).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const task = {
      id: taskId, organizationId, centreId, taskNumber: "RHC-T-EXPIRY", taskType: "GENERAL", priority: "NORMAL",
      status: "AWAITING_APPROVAL", approvalStatus: "PENDING", approvalPolicyId: policyId, requiresApproval: true,
      approvalExpiresAt: new Date(Date.now() - 60_000), escalationOwnerStaffId: null, escalationDueAt: null, escalationProcessedAt: null,
      assignedStaffId: assigneeId, createdByStaffId: creatorId, versionNumber: 1,
      privateDataCiphertext: encryptOperationalData({ title: "Synthetic approval expiry", description: "Expiry workflow regression" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task")),
    };
    const policy = { id: policyId, organizationId, actionType: "TASK_COMPLETION", enabled: true, expireAfterMinutes: 30 };
    const submissionId = "bd000000-0000-4000-8000-000000000007";
    const submission = { id: submissionId, privateDataCiphertext: encryptOperationalData({ approvalSnapshotVersion: 1, approvalPolicyId: policyId, approvalPolicyVersion: 1, approvalApproverStaffIds: [actorId] }, operationalContext({ organizationId, centreId, recordId: submissionId }, "staff-task-event")) };
    const results: unknown[][] = [[], [task], [policy], [submission], []];
    const select = vi.fn(() => {
      const value = results.shift();
      const query: Record<string, ReturnType<typeof vi.fn>> = {};
      query.from = vi.fn(() => query); query.innerJoin = vi.fn(() => query); query.where = vi.fn(() => query); query.for = vi.fn(() => query);
      query.orderBy = vi.fn(() => query); query.limit = vi.fn(async () => value ?? []);
      query.then = vi.fn((resolve: (rows: unknown[]) => unknown) => Promise.resolve(value ?? []).then(resolve));
      return query;
    });
    const eventValues = vi.fn().mockResolvedValue(undefined);
    const returning = vi.fn(async () => [{ id: taskId, versionNumber: 2, status: "IN_PROGRESS", approvalStatus: "EXPIRED" }]);
    const tx = { select, execute: vi.fn(), update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })) })), insert: vi.fn(() => ({ values: eventValues })) };
    getDb.mockReturnValue({ transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx) });
    getApiAccess.mockImplementation(async (permission: string) => ({ staff: { organizationId, staffUserId: actorId, grants: [{ key: permission, centreId }] }, response: null }));

    const response = await PATCH(patchRequest({ expectedVersion: 1, action: "EXPIRE_APPROVAL", reason: "Approval window elapsed" }), taskParams);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ task: { id: taskId, status: "IN_PROGRESS", approvalStatus: "EXPIRED" } });
    expect(eventValues).toHaveBeenCalledWith(expect.objectContaining({ eventType: "APPROVAL_EXPIRED", taskId, organizationId, centreId, actorStaffId: actorId }));
  });
});
