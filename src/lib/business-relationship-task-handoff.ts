import { canCreateStaffTaskAtCentre } from "@/lib/staff-task-access";
import type { PermissionGrant } from "@/server/permissions";

type RelationshipKind = "CORPORATE" | "PARTNER" | "DOCTOR";

export function getBusinessRelationshipTaskHref(input: {
  type: RelationshipKind;
  centreId: string;
  relationshipId: string;
  grants: readonly PermissionGrant[];
}) {
  if (!canCreateStaffTaskAtCentre(input.grants, input.centreId)) return null;
  const referenceType = input.type === "CORPORATE" ? "CORPORATE_RELATIONSHIP" : input.type === "PARTNER" ? "PARTNER_RELATIONSHIP" : "DOCTOR_RELATIONSHIP";
  const params = new URLSearchParams({
    centreId: input.centreId,
    referenceType,
    referenceId: input.relationshipId,
    taskType: "FOLLOW_UP",
  });
  return `/tasks?${params.toString()}`;
}
