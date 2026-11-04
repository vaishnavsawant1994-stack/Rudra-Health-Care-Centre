import { escalationSourceHref } from "@/lib/escalation-source-link";

/** Resolve a task's linked operational record using only its opaque ID and centre scope. */
export function taskReferenceHref(type: string, id: string, centreId: string) {
  if (type === "STAFF_TASK") return `/tasks?${new URLSearchParams({ taskId: id, centreId })}`;
  const sourceHref = escalationSourceHref(type, id, centreId);
  if (sourceHref) return sourceHref;
  if (type === "STAFF_ESCALATION") return `/escalations?${new URLSearchParams({ escalationId: id, centreId })}`;
  return null;
}
