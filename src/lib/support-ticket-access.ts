export function isSupportTicketRecord(value: unknown): value is { taskType: "SUPPORT_REQUEST" } {
  return Boolean(value && typeof value === "object" && "taskType" in value && value.taskType === "SUPPORT_REQUEST");
}
