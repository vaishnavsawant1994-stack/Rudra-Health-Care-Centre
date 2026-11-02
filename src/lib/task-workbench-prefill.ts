import type { TaskReferencePrefillType, TaskRelationshipReferenceType } from "@/lib/task-reference-permissions";
import { canCreateStaffTaskAtCentre } from "@/lib/staff-task-access";
import type { PermissionGrant } from "@/server/permissions";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveTaskWorkbenchPrefill(
  params: { taskId?: string; centreId?: string; referenceType?: string; referenceId?: string; taskType?: string },
  grants: readonly PermissionGrant[],
  allowedReferenceTypes: readonly TaskRelationshipReferenceType[],
) {
  const mayReadEscalationsAtCentre = params.centreId && grants.some((grant) => (grant.key === "escalations.read" || grant.key === "escalations.assigned.read") && (grant.centreId === null || grant.centreId === params.centreId));
  const initialReferenceType: TaskReferencePrefillType | undefined = params.referenceType === "STAFF_ESCALATION" && mayReadEscalationsAtCentre
    ? "STAFF_ESCALATION"
    : allowedReferenceTypes.find((type) => type === params.referenceType);
  const initialCentreId = params.centreId && uuidPattern.test(params.centreId) && canCreateStaffTaskAtCentre(grants, params.centreId) ? params.centreId : undefined;
  const initialReferenceId = params.referenceId && uuidPattern.test(params.referenceId) && initialReferenceType && initialCentreId ? params.referenceId : undefined;
  return {
    initialTaskId: params.taskId && uuidPattern.test(params.taskId) ? params.taskId : undefined,
    initialCentreId,
    initialReferenceType,
    initialReferenceId,
    initialTaskType: params.taskType === "FOLLOW_UP" ? "FOLLOW_UP" : undefined,
  };
}
