export type TaskAssignmentFilter = "ALL" | "ASSIGNED_TO_ME";

/** Accepts only a self-scoped assignment filter; callers cannot select another staff member. */
export function parseTaskAssignmentFilter(value: string | null): TaskAssignmentFilter | null {
  if (value === null || value === "") return "ALL";
  if (value === "me") return "ASSIGNED_TO_ME";
  return null;
}
