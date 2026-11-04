export type CentreTaskQueue = "expiry-due" | "escalation-due";

export function centreTaskHref(taskId: string, centreId: string, queue?: CentreTaskQueue) {
  return `${queue ? "/tasks/approvals" : "/tasks"}?${new URLSearchParams({ ...(queue ? { queue } : {}), taskId, centreId })}`;
}
