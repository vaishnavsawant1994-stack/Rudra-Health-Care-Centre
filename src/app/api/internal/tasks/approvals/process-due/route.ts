import { timingSafeEqual } from "node:crypto";
import { processDueTaskApprovalDeadlines } from "@/server/approval-deadline-worker";

function validJobToken(request: Request) {
  const expected = process.env.RUDRA_TASK_APPROVALS_JOB_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || expected.startsWith("REPLACE_") || Buffer.byteLength(expected) < 32 || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function POST(request: Request) {
  if (!validJobToken(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await processDueTaskApprovalDeadlines();
    return Response.json(result, { status: 200, headers: { "cache-control": "no-store" } });
  } catch {
    // Do not return database or task details to the caller.
    return Response.json({ error: "deadline_processing_failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
