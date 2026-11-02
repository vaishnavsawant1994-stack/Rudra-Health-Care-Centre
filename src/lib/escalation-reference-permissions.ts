import type { PermissionGrant } from "@/server/permissions";

export type EscalationReferenceType =
  | "APPOINTMENT" | "LEAD" | "LEAD_FOLLOWUP" | "PUBLIC_ENQUIRY" | "COLLECTION_JOB"
  | "SAMPLE_EXCEPTION" | "REPORT" | "REPORT_FOLLOWUP" | "FINANCE_PAYMENT" | "FINANCE_REFUND"
  | "STAFF_TASK" | "CORPORATE_RELATIONSHIP" | "PARTNER_RELATIONSHIP" | "DOCTOR_RELATIONSHIP";

const requiredPermission: Record<EscalationReferenceType, readonly string[]> = {
  APPOINTMENT: ["appointments.read", "appointments.assigned.read"],
  LEAD: ["leads.read"],
  LEAD_FOLLOWUP: ["leads.followups.manage"],
  PUBLIC_ENQUIRY: ["leads.read"],
  COLLECTION_JOB: ["collections.read", "collections.visit.record"],
  SAMPLE_EXCEPTION: ["samples.read"],
  REPORT: ["reports.read"],
  REPORT_FOLLOWUP: ["reports.followups.manage"],
  FINANCE_PAYMENT: ["finance.read"],
  FINANCE_REFUND: ["finance.read"],
  STAFF_TASK: ["tasks.read", "tasks.assigned.read", "tasks.support.read"],
  CORPORATE_RELATIONSHIP: ["corporate.read"],
  PARTNER_RELATIONSHIP: ["partners.read"],
  DOCTOR_RELATIONSHIP: ["doctors.read"],
};

/** Filters reference choices to readable domains; APIs still reauthorize each record. */
export function getEscalationReferenceTypes(grants: readonly PermissionGrant[], centreId?: string): EscalationReferenceType[] {
  const granted = new Set(grants
    .filter((grant) => !centreId || grant.centreId === null || grant.centreId === centreId)
    .map((grant) => grant.key));
  return (Object.keys(requiredPermission) as EscalationReferenceType[]).filter((type) =>
    requiredPermission[type].some((permission) => granted.has(permission)),
  );
}
