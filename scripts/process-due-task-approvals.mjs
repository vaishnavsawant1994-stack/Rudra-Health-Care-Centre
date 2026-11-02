import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadProjectEnvironment } from "./load-project-env.mjs";

const routePath = "/api/internal/tasks/approvals/process-due";

export function approvalJobEndpoint(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error("approval_job_url_invalid"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("approval_job_url_invalid");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) throw new Error("approval_job_https_required");
  url.pathname = `${url.pathname.replace(/\/$/, "")}${routePath}`;
  return url;
}

export async function processDueTaskApprovals({ baseUrl, token, fetchImpl = fetch }) {
  if (typeof token !== "string" || token.startsWith("REPLACE_") || Buffer.byteLength(token) < 32) throw new Error("approval_job_token_unavailable");
  const endpoint = approvalJobEndpoint(baseUrl);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("approval_job_request_failed");
  }
  if (!response.ok) throw new Error(response.status === 401 ? "approval_job_unauthorized" : "approval_job_request_failed");
  let result;
  try { result = await response.json(); } catch { throw new Error("approval_job_response_invalid"); }
  const fields = ["processed", "expired", "escalated", "skippedInvalidOwner", "limit"];
  if (!result || typeof result !== "object" || fields.some((field) => !Number.isInteger(result[field]) || result[field] < 0)) throw new Error("approval_job_response_invalid");
  return Object.fromEntries(fields.map((field) => [field, result[field]]));
}

export async function runApprovalDeadlineJob(environment = process.env, fetchImpl = fetch) {
  loadProjectEnvironment({ environment });
  const baseUrl = environment.RUDRA_TASK_APPROVALS_JOB_URL ?? environment.BETTER_AUTH_URL;
  if (!baseUrl) throw new Error("approval_job_url_unavailable");
  const result = await processDueTaskApprovals({ baseUrl, token: environment.RUDRA_TASK_APPROVALS_JOB_TOKEN, fetchImpl });
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runApprovalDeadlineJob();
    console.log(`Approval deadline job complete: ${result.processed} processed (${result.expired} expired, ${result.escalated} escalated, ${result.skippedInvalidOwner} skipped for invalid owner).`);
  } catch (error) {
    const code = error instanceof Error && /^approval_job_[a-z_]+$/.test(error.message) ? error.message : "approval_job_request_failed";
    console.error(`Approval deadline job did not complete: ${code}.`);
    process.exitCode = 1;
  }
}
