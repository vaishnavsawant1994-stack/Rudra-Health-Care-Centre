import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { processDueTaskApprovalDeadlines } from "@/server/approval-deadline-worker";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const access = await getApiAccess("tasks.approve");
  if (access.response) return access.response;
  const grants = access.staff.grants.filter((grant) => grant.key === "tasks.approve");
  const organizationWide = grants.some((grant) => grant.centreId === null);
  const centreIds = organizationWide ? null : [...new Set(grants.map((grant) => grant.centreId).filter((id): id is string => id !== null))];
  try {
    const result = await processDueTaskApprovalDeadlines(50, new Date(), {
      organizationId: access.staff.organizationId,
      centreIds,
      triggeredByStaffId: access.staff.staffUserId,
    });
    return Response.json(result, { status: 200, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "deadline_processing_failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
