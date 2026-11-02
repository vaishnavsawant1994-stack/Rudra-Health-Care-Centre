export type StaffTaskQueueBadgeInput = {
  taskType: string;
  status: string;
  approvalStatus: string;
  dueAt: Date | string | null;
  escalationDueAt: Date | string | null;
  escalationProcessedAt: Date | string | null;
};

function isPast(value: Date | string | null, now: Date) {
  if (!value) return false;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) && time <= now.getTime();
}

/** Labels queue state from persisted events and deadlines without implying an action occurred. */
export function getStaffTaskQueueBadges(task: StaffTaskQueueBadgeInput, now = new Date()) {
  const badges: string[] = [];
  const pendingApproval = task.status === "AWAITING_APPROVAL" && task.approvalStatus === "PENDING";

  if (pendingApproval && task.escalationProcessedAt) badges.push("Escalated");
  else if (pendingApproval && isPast(task.escalationDueAt, now)) badges.push("Escalation overdue");

  if (task.taskType === "EXCEPTION_REVIEW" && ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"].includes(task.status)) {
    badges.push(isPast(task.dueAt, now) ? "Exception review overdue" : "Exception review");
  }

  return badges;
}
