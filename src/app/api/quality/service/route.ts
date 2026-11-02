import { and, count, eq, inArray, lt, type SQL } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { staffTasks } from "@/db/schema";

/** Aggregate-only service workload. Private task text and patient references are never selected. */
export async function GET() {
  const access = await getApiAccess("tasks.support.read");
  if (access.response) return access.response;
  const grants = access.staff.grants.filter((grant) => grant.key === "tasks.support.read");
  const organizationWide = grants.some((grant) => grant.centreId === null);
  const centreIds = [...new Set(grants.map((grant) => grant.centreId).filter((id): id is string => id !== null))];
  if (!organizationWide && centreIds.length === 0) return Response.json({ error: "forbidden" }, { status: 403 });
  const scope = [eq(staffTasks.organizationId, access.staff.organizationId), eq(staffTasks.taskType, "SUPPORT_REQUEST")];
  if (!organizationWide) scope.push(inArray(staffTasks.centreId, centreIds));
  const db = getDb();
  const countFor = async (condition: SQL) => {
    const [row] = await db.select({ value: count() }).from(staffTasks).where(and(...scope, condition));
    return Number(row?.value ?? 0);
  };
  const now = new Date();
  const [open, inProgress, awaitingApproval, completed, overdue] = await Promise.all([
    countFor(eq(staffTasks.status, "OPEN")),
    countFor(eq(staffTasks.status, "IN_PROGRESS")),
    countFor(eq(staffTasks.status, "AWAITING_APPROVAL")),
    countFor(eq(staffTasks.status, "COMPLETED")),
    countFor(and(inArray(staffTasks.status, ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"]), lt(staffTasks.dueAt, now))!),
  ]);
  return Response.json({ summary: { open, inProgress, awaitingApproval, completed, overdue } }, { headers: { "cache-control": "no-store" } });
}
