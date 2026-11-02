import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const processMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/approval-deadline-worker", () => ({ processDueTaskApprovalDeadlines: processMock }));
import { POST } from "./route";

describe("internal approval deadline processing", () => {
  const original = process.env.RUDRA_TASK_APPROVALS_JOB_TOKEN;
  beforeEach(() => { vi.clearAllMocks(); process.env.RUDRA_TASK_APPROVALS_JOB_TOKEN = "x".repeat(40); });
  afterAll(() => { if (original === undefined) delete process.env.RUDRA_TASK_APPROVALS_JOB_TOKEN; else process.env.RUDRA_TASK_APPROVALS_JOB_TOKEN = original; });

  it("fails closed when the job secret is missing", async () => {
    delete process.env.RUDRA_TASK_APPROVALS_JOB_TOKEN;
    const response = await POST(new Request("http://localhost/api/internal/tasks/approvals/process-due", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("does not accept the checked-in environment placeholder as a credential", async () => {
    process.env.RUDRA_TASK_APPROVALS_JOB_TOKEN = "REPLACE_WITH_32_PLUS_RANDOM_CHAR_SECRET";
    const response = await POST(new Request("http://localhost/api/internal/tasks/approvals/process-due", { method: "POST", headers: { authorization: "Bearer REPLACE_WITH_32_PLUS_RANDOM_CHAR_SECRET" } }));
    expect(response.status).toBe(401);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("rejects an incorrect secret and does not reveal configuration", async () => {
    const response = await POST(new Request("http://localhost/api/internal/tasks/approvals/process-due", { method: "POST", headers: { authorization: `Bearer ${"y".repeat(40)}` } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(processMock).not.toHaveBeenCalled();
  });

  it("runs only after the configured bearer secret is supplied", async () => {
    processMock.mockResolvedValue({ processed: 2, expired: 1, escalated: 1, skippedInvalidOwner: 0, limit: 50 });
    const response = await POST(new Request("http://localhost/api/internal/tasks/approvals/process-due", { method: "POST", headers: { authorization: `Bearer ${"x".repeat(40)}` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ expired: 1, escalated: 1 });
    expect(processMock).toHaveBeenCalledOnce();
  });
});
