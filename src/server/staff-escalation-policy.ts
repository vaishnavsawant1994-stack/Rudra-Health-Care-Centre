export type EscalationAction = "ACKNOWLEDGE" | "COMMENT" | "UPDATE" | "REASSIGN" | "RESOLVE" | "REOPEN" | "CANCEL";
export type EscalationStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED";
export type EscalationReadGrant = { key: string; centreId: string | null };
export { canManageEscalationInCentre as canManageEscalation } from "@/lib/escalation-permissions";

export function escalationReadScope(grants: readonly EscalationReadGrant[], staffId: string) {
  const broad = grants.filter((grant) => grant.key === "escalations.read");
  const assigned = grants.filter((grant) => grant.key === "escalations.assigned.read");
  return {
    allCentresBroad: broad.some((grant) => grant.centreId === null),
    broadCentres: [...new Set(broad.map((grant) => grant.centreId).filter((id): id is string => id !== null))],
    assignedCentres: [...new Set(assigned.map((grant) => grant.centreId).filter((id): id is string => id !== null))],
    assignedEverywhere: assigned.some((grant) => grant.centreId === null),
    staffId,
  };
}

export function escalationActionAllowed(input: { action: EscalationAction; status: EscalationStatus; assignedOwnerStaffId: string; actorStaffId: string; canManage: boolean }) {
  const { action, status, assignedOwnerStaffId, actorStaffId, canManage } = input;
  if (["UPDATE", "REASSIGN", "REOPEN", "CANCEL"].includes(action) && !canManage) return false;
  if (action === "UPDATE") return canManage && ["OPEN", "ACKNOWLEDGED"].includes(status);
  if (action === "ACKNOWLEDGE") return status === "OPEN" && (assignedOwnerStaffId === actorStaffId || canManage);
  if (action === "COMMENT") return ["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(status) && (assignedOwnerStaffId === actorStaffId || canManage);
  if (action === "RESOLVE") return ["OPEN", "ACKNOWLEDGED"].includes(status) && (assignedOwnerStaffId === actorStaffId || canManage);
  if (action === "REASSIGN" || action === "CANCEL") return canManage && ["OPEN", "ACKNOWLEDGED"].includes(status);
  return action === "REOPEN" && canManage && status === "RESOLVED";
}
