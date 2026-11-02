import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), process: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/server/approval-deadline-worker", () => ({ processDueTaskApprovalDeadlines: mocks.process }));

import { POST } from "./route";

describe("staff-triggered approval deadline processing", () => {
  beforeEach(() => {
    mocks.getApiAccess.mockReset(); mocks.process.mockReset();
    mocks.process.mockResolvedValue({ processed: 0, expired: 0, escalated: 0, skippedInvalidOwner: 0, limit: 50 });
  });

  it("rejects cross-origin requests before checking access or processing", async () => {
    const response = await POST(new Request("http://localhost/api/tasks/approvals/process-due", { method: "POST", headers: { origin: "https://attacker.invalid" } }));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("requires an authenticated MFA-complete task approver", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await POST(new Request("http://localhost/api/tasks/approvals/process-due", { method: "POST", headers: { origin: "http://localhost" } }));
    expect(response.status).toBe(428);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("passes organization and centre scope to the worker for an authorized supervisor", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", staffUserId: "staff-a", grants: [{ key: "tasks.approve", centreId: "centre-a" }, { key: "tasks.approve", centreId: "centre-b" }] }, response: null });
    const response = await POST(new Request("http://localhost/api/tasks/approvals/process-due", { method: "POST", headers: { origin: "http://localhost" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.process).toHaveBeenCalledWith(50, expect.any(Date), { organizationId: "org-a", centreIds: ["centre-a", "centre-b"], triggeredByStaffId: "staff-a" });
  });
});
