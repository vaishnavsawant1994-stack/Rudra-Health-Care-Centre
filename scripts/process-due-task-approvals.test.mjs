import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalJobEndpoint, processDueTaskApprovals } from "./process-due-task-approvals.mjs";

const token = "synthetic-test-job-token-with-more-than-32-characters";

describe("approval deadline scheduler caller", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("accepts local HTTP and remote HTTPS while rejecting insecure remote transport", () => {
    expect(approvalJobEndpoint("http://localhost:3000").href).toBe("http://localhost:3000/api/internal/tasks/approvals/process-due");
    expect(approvalJobEndpoint("https://rudra.example").href).toBe("https://rudra.example/api/internal/tasks/approvals/process-due");
    expect(() => approvalJobEndpoint("http://rudra.example")).toThrow("approval_job_https_required");
    expect(() => approvalJobEndpoint("https://user:pass@rudra.example")).toThrow("approval_job_url_invalid");
    expect(() => approvalJobEndpoint("https://rudra.example/?token=secret")).toThrow("approval_job_url_invalid");
  });

  it("sends a bounded authenticated POST and returns only aggregate counters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ processed: 3, expired: 1, escalated: 2, skippedInvalidOwner: 0, limit: 50 }), { status: 200 }));
    const result = await processDueTaskApprovals({ baseUrl: "http://127.0.0.1:3000", token, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(new URL("http://127.0.0.1:3000/api/internal/tasks/approvals/process-due"), expect.objectContaining({ method: "POST", redirect: "error", cache: "no-store", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: expect.any(AbortSignal) }));
    expect(result).toEqual({ processed: 3, expired: 1, escalated: 2, skippedInvalidOwner: 0, limit: 50 });
  });

  it("rejects placeholder credentials before making a request", async () => {
    const fetchImpl = vi.fn();
    await expect(processDueTaskApprovals({ baseUrl: "http://localhost:3000", token: "REPLACE_WITH_32_PLUS_RANDOM_CHAR_SECRET", fetchImpl })).rejects.toThrow("approval_job_token_unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not surface server response bodies or network exception details", async () => {
    const response = new Response("sensitive database details", { status: 500 });
    await expect(processDueTaskApprovals({ baseUrl: "http://localhost:3000", token, fetchImpl: vi.fn().mockResolvedValue(response) })).rejects.toThrow("approval_job_request_failed");
    await expect(processDueTaskApprovals({ baseUrl: "http://localhost:3000", token, fetchImpl: vi.fn().mockRejectedValue(new Error(token)) })).rejects.toThrow("approval_job_request_failed");
  });

  it("rejects unexpected or malformed aggregate responses", async () => {
    await expect(processDueTaskApprovals({ baseUrl: "http://localhost:3000", token, fetchImpl: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })) })).rejects.toThrow("approval_job_response_invalid");
  });
});
