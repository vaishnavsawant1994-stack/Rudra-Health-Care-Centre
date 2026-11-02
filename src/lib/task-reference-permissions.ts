export type TaskRelationshipReferenceType = "CORPORATE_RELATIONSHIP" | "PARTNER_RELATIONSHIP" | "DOCTOR_RELATIONSHIP";
export type TaskReferencePrefillType = TaskRelationshipReferenceType | "STAFF_ESCALATION";

const permissionByReference: ReadonlyArray<[TaskRelationshipReferenceType, string]> = [
  ["CORPORATE_RELATIONSHIP", "corporate.read"],
  ["PARTNER_RELATIONSHIP", "partners.read"],
  ["DOCTOR_RELATIONSHIP", "doctors.read"],
];

export function getTaskRelationshipReferenceTypes(grants: ReadonlyArray<{ key: string }>): TaskRelationshipReferenceType[] {
  const keys = new Set(grants.map((grant) => grant.key));
  return permissionByReference.filter(([, permission]) => keys.has(permission)).map(([type]) => type);
}
