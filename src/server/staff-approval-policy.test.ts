import { describe, expect, it } from "vitest";
import { approvalEscalationOwnerConflicts, approvalPolicyCentreScope, approvalPolicyDirectoryScopeAllowed, approvalPolicyScopeAllowed, buildApprovalPolicyDirectory, canRequestTaskApproval, getApprovalEscalationDueAt, getApprovalExpiryAt, isNamedApproverEligible, readApprovalSubmissionSnapshot, supportedStaffApprovalActions } from "./staff-approval-policy";

describe("staff approval policy", () => {
  it("supports only enabled operational task-completion approval", () => {
    expect(supportedStaffApprovalActions).toEqual(["TASK_COMPLETION"]);
    expect(canRequestTaskApproval({ actionType: "TASK_COMPLETION", enabled: true })).toBe(true);
    expect(canRequestTaskApproval({ actionType: "TASK_COMPLETION", enabled: false })).toBe(false);
    expect(canRequestTaskApproval(null)).toBe(false);
    expect(canRequestTaskApproval({ actionType: "REFUND_APPROVAL", enabled: true })).toBe(false);
    expect(canRequestTaskApproval({ actionType: "REPORT_RELEASE", enabled: true })).toBe(false);
  });

  it("enforces named approvers while allowing permission-scoped approvers when no names are configured", () => {
    expect(isNamedApproverEligible([], "staff-a")).toBe(true);
    expect(isNamedApproverEligible(["staff-a"], "staff-a")).toBe(true);
    expect(isNamedApproverEligible(["staff-a"], "staff-b")).toBe(false);
  });

  it("reads immutable approval submission snapshots and fails closed on corrupt snapshots", () => {
    expect(readApprovalSubmissionSnapshot({ approvalSnapshotVersion: 1, approvalPolicyId: "policy-a", approvalPolicyVersion: 4, approvalApproverStaffIds: ["staff-a"] })).toEqual({ policyId: "policy-a", policyVersion: 4, approverStaffIds: ["staff-a"] });
    expect(readApprovalSubmissionSnapshot({ reason: "legacy event" })).toBeUndefined();
    expect(() => readApprovalSubmissionSnapshot({ approvalSnapshotVersion: 1, approvalPolicyId: "policy-a", approvalPolicyVersion: 4 })).toThrow("approval_snapshot_invalid");
    expect(() => readApprovalSubmissionSnapshot({ approvalSnapshotVersion: 1, approvalPolicyId: "policy-a", approvalPolicyVersion: 4, approvalApproverStaffIds: ["staff-a", "staff-a"] })).toThrow("approval_snapshot_invalid");
  });

  it("calculates configured escalation due times and rejects unsafe policy values", () => {
    const submittedAt = new Date("2026-10-29T10:00:00.000Z");
    expect(getApprovalEscalationDueAt(submittedAt, null)).toBeNull();
    expect(getApprovalEscalationDueAt(submittedAt, 30)?.toISOString()).toBe("2026-10-29T10:30:00.000Z");
    expect(() => getApprovalEscalationDueAt(submittedAt, 1)).toThrow("invalid_escalation_policy");
  });

  it("calculates optional approval expiry and bounds configured values", () => {
    const submittedAt = new Date("2026-10-29T10:00:00.000Z");
    expect(getApprovalExpiryAt(submittedAt, null)).toBeNull();
    expect(getApprovalExpiryAt(submittedAt, 30)?.toISOString()).toBe("2026-10-29T10:30:00.000Z");
    expect(() => getApprovalExpiryAt(submittedAt, 1)).toThrow("invalid_approval_expiry_policy");
  });

  it("rejects a configured or reassigned escalation owner who created or owns the task", () => {
    expect(approvalEscalationOwnerConflicts("creator", "assignee", "creator")).toBe(true);
    expect(approvalEscalationOwnerConflicts("assignee", "assignee", "creator")).toBe(true);
    expect(approvalEscalationOwnerConflicts("independent-approver", "assignee", "creator")).toBe(false);
    expect(approvalEscalationOwnerConflicts(null, "assignee", "creator")).toBe(false);
  });

  it("limits approval-policy centre choices to the policy-management grants", () => {
    expect(approvalPolicyCentreScope([{ key: "tasks.policy.manage", centreId: "centre-a" }, { key: "roster.read", centreId: "centre-b" }])).toEqual(["centre-a"]);
    expect(approvalPolicyCentreScope([{ key: "tasks.policy.manage", centreId: "centre-a" }, { key: "tasks.policy.manage", centreId: "centre-b" }])).toEqual(["centre-a", "centre-b"]);
    expect(approvalPolicyCentreScope([{ key: "tasks.policy.manage", centreId: null }])).toBeNull();
    expect(approvalPolicyCentreScope([{ key: "roster.manage", centreId: null }])).toEqual([]);
  });

  it("limits directory rows to explicitly granted policy scopes", () => {
    const centreAdmin = [{ key: "tasks.policy.manage", centreId: "centre-a" }];
    expect(approvalPolicyDirectoryScopeAllowed(centreAdmin, "centre-a")).toBe(true);
    expect(approvalPolicyDirectoryScopeAllowed(centreAdmin, "centre-b")).toBe(false);
    expect(approvalPolicyDirectoryScopeAllowed(centreAdmin, null)).toBe(false);
    expect(approvalPolicyDirectoryScopeAllowed([{ key: "tasks.policy.manage", centreId: null }], null)).toBe(true);
    expect(approvalPolicyDirectoryScopeAllowed([{ key: "tasks.policy.manage", centreId: null }], "centre-b")).toBe(true);
  });

  it("lists unconfigured authorized scopes without exposing other centres", () => {
    const grants = [{ key: "tasks.policy.manage", centreId: "centre-a" }] as const;
    const rows = buildApprovalPolicyDirectory(grants, [
      { id: "centre-a", code: "A", name: "Centre A" },
      { id: "centre-b", code: "B", name: "Centre B" },
    ], []);
    expect(rows).toEqual([{
      id: null, centreId: "centre-a", centreName: "Centre A", centreCode: "A", actionType: "TASK_COMPLETION",
      enabled: false, configured: false, versionNumber: null, escalationAfterMinutes: null, updatedAt: null,
      expireAfterMinutes: null,
    }]);
  });

  it("includes the organization default only for organization-wide managers", () => {
    const organizationGrant = [{ key: "tasks.policy.manage", centreId: null }] as const;
    const rows = buildApprovalPolicyDirectory(organizationGrant, [{ id: "centre-a", code: "A", name: "Centre A" }], []);
    expect(rows.map((row) => row.centreId)).toEqual([null, "centre-a"]);
    expect(rows.every((row) => !row.configured)).toBe(true);
  });

  it("requires an organization-scoped grant for the default policy and exact scope for centre policies", () => {
    const centreAdmin = [{ key: "tasks.policy.manage", centreId: "centre-a" }];
    expect(approvalPolicyScopeAllowed(centreAdmin, null)).toBe(false);
    expect(approvalPolicyScopeAllowed(centreAdmin, "centre-a")).toBe(true);
    expect(approvalPolicyScopeAllowed(centreAdmin, "centre-b")).toBe(false);
    expect(approvalPolicyScopeAllowed([{ key: "tasks.policy.manage", centreId: null }], null)).toBe(true);
    expect(approvalPolicyScopeAllowed([{ key: "tasks.policy.manage", centreId: null }], "centre-b")).toBe(true);
  });
});
