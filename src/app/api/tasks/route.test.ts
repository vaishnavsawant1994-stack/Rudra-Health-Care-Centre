import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));
import { GET, POST } from "./route";

describe("staff task queue filters", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("rejects unknown task-type filters after authorization and before database access", async () => {
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", staffUserId: "staff-a", grants: [{ key: "tasks.read", centreId: "centre-a" }] }, response: null });

    const response = await GET(new Request("http://localhost/api/tasks?type=PATIENT_MEDICAL_CASE"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_task_type" });
    expect(getApiAccess).toHaveBeenCalledWith("tasks.read", undefined);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects unknown task-status filters instead of returning an unfiltered queue", async () => {
    getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", staffUserId: "staff-a", grants: [{ key: "tasks.read", centreId: "centre-a" }] }, response: null });
    const response = await GET(new Request("http://localhost/api/tasks?status=APPROVAL_EXPIRY"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_task_status" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects invalid task queue pages before authorization or database access", async () => {
    for (const page of ["0", "-1", "1.5", "100001", "not-a-page"]) {
      const response = await GET(new Request(`http://localhost/api/tasks?page=${encodeURIComponent(page)}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_page" });
    }
    expect(getApiAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("denies support-request creation unless the scoped support-create grant exists", async () => {
    const centreId = crypto.randomUUID();
    getApiAccess.mockResolvedValue({ staff: { organizationId: crypto.randomUUID(), staffUserId: crypto.randomUUID(), grants: [{ key: "tasks.create", centreId }] }, response: null });
    const response = await POST(new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ centreId, assignedStaffId: crypto.randomUUID(), title: "Synthetic service issue", taskType: "SUPPORT_REQUEST" }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(getApiAccess).toHaveBeenCalledTimes(1);
    expect(getDb).not.toHaveBeenCalled();
  });
});
