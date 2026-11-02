import type { PermissionGrant } from "@/server/permissions";

export const supportedStaffApprovalActions = ["TASK_COMPLETION"] as const;
export type SupportedStaffApprovalAction = (typeof supportedStaffApprovalActions)[number];

export function canRequestTaskApproval(policy: { actionType: string; enabled: boolean } | null | undefined): policy is { actionType: "TASK_COMPLETION"; enabled: true } {
  return Boolean(policy && policy.actionType === "TASK_COMPLETION" && policy.enabled);
}

export function isNamedApproverEligible(namedApproverIds: readonly string[], staffId: string) {
  return namedApproverIds.length === 0 || namedApproverIds.includes(staffId);
}

export type ApprovalSubmissionSnapshot = { policyId: string; policyVersion: number; approverStaffIds: string[] };

/** Returns undefined for pre-snapshot legacy events; malformed snapshots fail closed. */
export function readApprovalSubmissionSnapshot(value: unknown): ApprovalSubmissionSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, "approvalSnapshotVersion") && !Object.hasOwn(record, "approvalApproverStaffIds")) return undefined;
  if (record.approvalSnapshotVersion !== 1 || typeof record.approvalPolicyId !== "string" || !record.approvalPolicyId || !Number.isInteger(record.approvalPolicyVersion) || (record.approvalPolicyVersion as number) < 1 || !Array.isArray(record.approvalApproverStaffIds) || !record.approvalApproverStaffIds.every((id) => typeof id === "string") || new Set(record.approvalApproverStaffIds).size !== record.approvalApproverStaffIds.length) {
    throw new Error("approval_snapshot_invalid");
  }
  return { policyId: record.approvalPolicyId, policyVersion: record.approvalPolicyVersion as number, approverStaffIds: record.approvalApproverStaffIds as string[] };
}

export function getApprovalEscalationDueAt(submittedAt: Date, escalationAfterMinutes: number | null) {
  if (escalationAfterMinutes === null) return null;
  if (!Number.isInteger(escalationAfterMinutes) || escalationAfterMinutes < 15 || escalationAfterMinutes > 10_080) throw new Error("invalid_escalation_policy");
  return new Date(submittedAt.getTime() + escalationAfterMinutes * 60_000);
}

export function getApprovalExpiryAt(submittedAt: Date, expireAfterMinutes: number | null) {
  if (expireAfterMinutes === null) return null;
  if (!Number.isInteger(expireAfterMinutes) || expireAfterMinutes < 15 || expireAfterMinutes > 10_080) throw new Error("invalid_approval_expiry_policy");
  return new Date(submittedAt.getTime() + expireAfterMinutes * 60_000);
}

export function approvalEscalationOwnerConflicts(ownerStaffId: string | null, assignedStaffId: string, createdByStaffId: string) {
  return ownerStaffId !== null && (ownerStaffId === assignedStaffId || ownerStaffId === createdByStaffId);
}

export function approvalPolicyCentreScope(grants: readonly PermissionGrant[]) {
  const scoped = grants.filter((grant) => grant.key === "tasks.policy.manage");
  if (scoped.some((grant) => grant.centreId === null)) return null;
  return [...new Set(scoped.map((grant) => grant.centreId).filter((id): id is string => id !== null))];
}

export function approvalPolicyScopeAllowed(grants: readonly PermissionGrant[], centreId: string | null) {
  return grants.some((grant) => grant.key === "tasks.policy.manage" && (centreId === null ? grant.centreId === null : grant.centreId === null || grant.centreId === centreId));
}

export function approvalPolicyDirectoryScopeAllowed(grants: readonly PermissionGrant[], policyCentreId: string | null) {
  const scope = approvalPolicyCentreScope(grants);
  return scope === null || (policyCentreId !== null && scope.includes(policyCentreId));
}

export type ApprovalPolicyDirectoryScope = { id: string; code: string; name: string };
export type ApprovalPolicyDirectoryConfiguration = { id: string; centreId: string | null; enabled: boolean; versionNumber: number; escalationAfterMinutes: number | null; expireAfterMinutes: number | null; updatedAt: Date | string };

export function buildApprovalPolicyDirectory(
  grants: readonly PermissionGrant[],
  centres: readonly ApprovalPolicyDirectoryScope[],
  policies: readonly ApprovalPolicyDirectoryConfiguration[],
) {
  const byCentre = new Map(policies.map((policy) => [policy.centreId ?? "__organization__", policy]));
  const rows = [];
  if (approvalPolicyDirectoryScopeAllowed(grants, null)) {
    const policy = byCentre.get("__organization__");
    rows.push({ id: policy?.id ?? null, centreId: null, centreName: null, centreCode: null, actionType: "TASK_COMPLETION" as const, enabled: policy?.enabled ?? false, configured: Boolean(policy), versionNumber: policy?.versionNumber ?? null, escalationAfterMinutes: policy?.escalationAfterMinutes ?? null, expireAfterMinutes: policy?.expireAfterMinutes ?? null, updatedAt: policy?.updatedAt ?? null });
  }
  for (const centre of centres) {
    if (!approvalPolicyDirectoryScopeAllowed(grants, centre.id)) continue;
    const policy = byCentre.get(centre.id);
    rows.push({ id: policy?.id ?? null, centreId: centre.id, centreName: centre.name, centreCode: centre.code, actionType: "TASK_COMPLETION" as const, enabled: policy?.enabled ?? false, configured: Boolean(policy), versionNumber: policy?.versionNumber ?? null, escalationAfterMinutes: policy?.escalationAfterMinutes ?? null, expireAfterMinutes: policy?.expireAfterMinutes ?? null, updatedAt: policy?.updatedAt ?? null });
  }
  return rows;
}
