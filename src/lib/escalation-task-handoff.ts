import { canCreateStaffTaskAtCentre } from "@/lib/staff-task-access";
import type { PermissionGrant } from "@/server/permissions";

export function getEscalationTaskHref(input: { centreId: string; escalationId: string; grants: readonly PermissionGrant[] }) {
  const mayReadEscalation = input.grants.some((grant) =>
    (grant.key === "escalations.read" || grant.key === "escalations.assigned.read")
    && (grant.centreId === null || grant.centreId === input.centreId),
  );
  if (!mayReadEscalation || !canCreateStaffTaskAtCentre(input.grants, input.centreId)) return null;
  const params = new URLSearchParams({
    centreId: input.centreId,
    referenceType: "STAFF_ESCALATION",
    referenceId: input.escalationId,
    taskType: "FOLLOW_UP",
  });
  return `/tasks?${params.toString()}`;
}
