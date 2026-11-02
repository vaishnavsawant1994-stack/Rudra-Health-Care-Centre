import type { PermissionGrant } from "@/server/permissions";
import { assignmentVisibility, assignmentVisibilityAtCentre } from "@/server/assignment-visibility";

const aggregatePermissions = ["appointments.read", "appointments.assigned.read", "orders.read", "collections.read", "collections.assign", "collections.visit.record", "samples.read", "samples.receive", "samples.dispatch", "samples.exceptions.manage", "leads.read", "leads.followups.manage", "reports.followups.manage", "tasks.read", "tasks.assigned.read", "tasks.approve", "roster.read", "roster.manage", "escalations.read", "escalations.assigned.read", "finance.read"] as const;

export function canViewAnyOperationsSummary(grants: readonly PermissionGrant[]) {
  return aggregatePermissions.some((key) => grants.some((grant) => grant.key === key));
}

export function visibleOperationsCentres(grants: readonly PermissionGrant[]) {
  if (!canViewAnyOperationsSummary(grants)) return [];
  if (aggregatePermissions.some((key) => grants.some((grant) => grant.key === key && grant.centreId === null))) return null;
  return [...new Set(grants.filter((grant) => aggregatePermissions.includes(grant.key as typeof aggregatePermissions[number])).map((grant) => grant.centreId).filter((id): id is string => id !== null))];
}

export function canViewOperationsMetric(grants: readonly PermissionGrant[], permission: string, centreId: string) {
  return grants.some((grant) => grant.key === permission && (grant.centreId === null || grant.centreId === centreId));
}

/** Centre-wide roster totals require the same team scope as coworker roster visibility. */
export function canViewTeamRosterMetrics(grants: readonly PermissionGrant[], centreId: string) {
  return canViewOperationsMetric(grants, "roster.manage", centreId) || canViewOperationsMetric(grants, "staff.read", centreId);
}

export function sampleExceptionSummaryScope(grants: readonly PermissionGrant[], centreId: string): "all" | "assigned" | "none" {
  if (canViewOperationsMetric(grants, "samples.exceptions.manage", centreId)) return "all";
  if (!canViewOperationsMetric(grants, "samples.read", centreId)) return "none";
  const visibility = assignmentVisibility(grants, "samples.read", "collections.assign", ["samples.collect", "collections.visit.record"]);
  return assignmentVisibilityAtCentre(visibility, centreId);
}

export function canViewTaskApprovalExpiryQueue(grants: readonly PermissionGrant[], centreId: string) {
  return canViewOperationsMetric(grants, "tasks.approve", centreId) && canViewOperationsMetric(grants, "tasks.read", centreId);
}

export function collectionSummaryIsAssignedOnly(grants: readonly PermissionGrant[], centreId: string) {
  const inScope = (grant: PermissionGrant) => grant.centreId === null || grant.centreId === centreId;
  return grants.some((grant) => grant.key === "collections.visit.record" && inScope(grant))
    && !grants.some((grant) => grant.key === "collections.assign" && inScope(grant));
}
