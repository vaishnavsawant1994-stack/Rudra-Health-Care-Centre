import { describe, expect, it } from "vitest";
import { canReadTask, canTriggerConfiguredApprovalEscalation, canUpdateTask, independentTaskApproverIds, staffTaskCreateSchema, staffTaskPatchSchema, taskApprovalDecisionIsIndependent, taskCanTransition, taskCentreReadScope, taskQueueIsAssignedOnly, validateSupportResolutionOutcome } from "./staff-task-policy";
import { approvalEscalationOwnerConflicts } from "./staff-approval-policy";

describe("staff task access and lifecycle", () => {
  const owner = [{ key: "tasks.read", centreId: null }, { key: "tasks.update", centreId: null }];
  const worker = [{ key: "tasks.assigned.read", centreId: "c1" }, { key: "tasks.update", centreId: "c1" }];
  it("derives task centre filters only from scoped task-read grants", () => {
    expect(taskCentreReadScope(owner)).toBeNull();
    expect(taskCentreReadScope([{ key: "tasks.read", centreId: "c2" }, { key: "tasks.read", centreId: "c1" }, { key: "tasks.read", centreId: "c1" }])).toEqual(["c1", "c2"]);
    expect(taskCentreReadScope([{ key: "tasks.assigned.read", centreId: null }])).toEqual([]);
  });
  it("scopes task visibility and worker edits to assigned centre tasks", () => {
    expect(canReadTask(worker, "c1", "s1", "s1")).toBe(true);
    expect(canReadTask(worker, "c1", "s2", "s1")).toBe(false);
    expect(canReadTask(worker, "c2", "s1", "s1")).toBe(false);
    expect(canUpdateTask(worker, "c1", "s1", "s1")).toBe(true);
    expect(canUpdateTask(worker, "c1", "s2", "s1")).toBe(false);
    expect(canReadTask(owner, "c2", "s2", "s1")).toBe(true);
  });
  it("shares only support-request tasks with explicitly authorized centre support staff", () => {
    const support = [{ key: "tasks.assigned.read", centreId: "c1" }, { key: "tasks.support.read", centreId: "c1" }, { key: "tasks.update", centreId: "c1" }, { key: "tasks.support.manage", centreId: "c1" }];
    expect(canReadTask(support, "c1", "reception", "support", undefined, "SUPPORT_REQUEST")).toBe(true);
    expect(canReadTask(support, "c1", "other", "support", undefined, "GENERAL")).toBe(false);
    expect(canReadTask(support, "c2", "reception", "support", undefined, "SUPPORT_REQUEST")).toBe(false);
    expect(canUpdateTask(support, "c1", "reception", "support", "SUPPORT_REQUEST")).toBe(true);
    expect(canUpdateTask(support, "c1", "other", "support", "GENERAL")).toBe(false);
  });
  it("keeps a support reader with assigned-task access in the assigned-only database scope", () => {
    expect(taskQueueIsAssignedOnly([
      { key: "tasks.assigned.read", centreId: "c1" },
      { key: "tasks.support.read", centreId: "c1" },
    ], "c1")).toBe(true);
    expect(taskQueueIsAssignedOnly([
      { key: "tasks.assigned.read", centreId: "c1" },
      { key: "tasks.support.read", centreId: "c1" },
      { key: "tasks.read", centreId: "c1" },
    ], "c1")).toBe(false);
    expect(taskQueueIsAssignedOnly([
      { key: "tasks.assigned.read", centreId: "c2" },
      { key: "tasks.support.read", centreId: "c1" },
    ], "c1")).toBe(false);
  });
  it("reveals a processed escalation only to its configured owner with assigned-task access", () => {
    const approver = [{ key: "tasks.assigned.read", centreId: "c1" }];
    expect(canReadTask(approver, "c1", "worker", "approver", { ownerStaffId: "approver", processedAt: null, pending: true })).toBe(false);
    expect(canReadTask(approver, "c1", "worker", "approver", { ownerStaffId: "approver", processedAt: new Date(), pending: true })).toBe(true);
    expect(canReadTask(approver, "c1", "worker", "approver", { ownerStaffId: "approver", processedAt: new Date(), pending: false })).toBe(false);
    expect(canReadTask(approver, "c2", "worker", "approver", { ownerStaffId: "approver", processedAt: new Date(), pending: true })).toBe(false);
  });
  it("requires approval for tasks explicitly marked for review", () => {
    expect(taskCanTransition("IN_PROGRESS", "COMPLETE", true, "NOT_REQUIRED")).toBe(false);
    expect(taskCanTransition("IN_PROGRESS", "SUBMIT_APPROVAL", true, "NOT_REQUIRED")).toBe(true);
    expect(taskCanTransition("AWAITING_APPROVAL", "APPROVE", true, "PENDING")).toBe(true);
    expect(taskCanTransition("AWAITING_APPROVAL", "EXPIRE_APPROVAL", true, "PENDING")).toBe(true);
    expect(taskCanTransition("IN_PROGRESS", "EXPIRE_APPROVAL", true, "PENDING")).toBe(false);
    expect(taskCanTransition("AWAITING_APPROVAL", "TRIGGER_ESCALATION", true, "PENDING")).toBe(true);
    expect(taskCanTransition("IN_PROGRESS", "TRIGGER_ESCALATION", true, "PENDING")).toBe(false);
    expect(taskCanTransition("AWAITING_APPROVAL", "APPROVE", true, "APPROVED")).toBe(false);
    expect(taskCanTransition("COMPLETED", "UPDATE", false, "NOT_REQUIRED")).toBe(false);
    expect(taskCanTransition("CANCELLED", "COMMENT", false, "NOT_REQUIRED")).toBe(false);
  });
  it("keeps task creators and assignees out of their own approval decisions", () => {
    expect(taskApprovalDecisionIsIndependent("reviewer", "creator", "assignee")).toBe(true);
    expect(taskApprovalDecisionIsIndependent("creator", "creator", "assignee")).toBe(false);
    expect(taskApprovalDecisionIsIndependent("assignee", "creator", "assignee")).toBe(false);
    expect(independentTaskApproverIds(["creator", "reviewer", "assignee", "reviewer-2"], "creator", "assignee")).toEqual(["reviewer", "reviewer-2"]);
  });
  it("validates task content and decision reasons", () => {
    expect(staffTaskCreateSchema.safeParse({ centreId: crypto.randomUUID(), assignedStaffId: crypto.randomUUID(), title: "Synthetic task" }).success).toBe(true);
    const support = { centreId: crypto.randomUUID(), assignedStaffId: crypto.randomUUID(), title: "Review service issue" };
    expect(staffTaskCreateSchema.safeParse({ ...support, taskType: "SUPPORT_REQUEST" }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...support, taskType: "PATIENT_MEDICAL_CASE" }).success).toBe(false);
    expect(staffTaskPatchSchema.safeParse({ expectedVersion: 1, action: "REJECT" }).success).toBe(false);
    expect(staffTaskPatchSchema.safeParse({ expectedVersion: 1, action: "EXPIRE_APPROVAL", reason: "Approval window elapsed" }).success).toBe(true);
    expect(staffTaskPatchSchema.safeParse({ expectedVersion: 1, action: "REOPEN" }).success).toBe(false);
    expect(staffTaskPatchSchema.safeParse({ expectedVersion: 1, action: "REOPEN", reason: "Work must be completed after review" }).success).toBe(true);
    expect(staffTaskPatchSchema.safeParse({ expectedVersion: 1, action: "COMMENT", comment: "Reviewed" }).success).toBe(true);
    expect(staffTaskPatchSchema.safeParse({ expectedVersion: 1, action: "REASSIGN_ESCALATION", reason: "Reassign queue", escalationOwnerStaffId: crypto.randomUUID(), escalationDueAt: new Date(Date.now() + 60_000).toISOString() }).success).toBe(true);
    expect(staffTaskPatchSchema.safeParse({ expectedVersion: 1, action: "REASSIGN_ESCALATION", reason: "Reassign queue", escalationOwnerStaffId: crypto.randomUUID(), escalationDueAt: new Date(Date.now() - 60_000).toISOString() }).success).toBe(false);
  });
  it("requires a structured outcome for support completion and approval submission only", () => {
    expect(validateSupportResolutionOutcome("SUPPORT_REQUEST", "COMPLETE", undefined)).toBe(false);
    expect(validateSupportResolutionOutcome("SUPPORT_REQUEST", "COMPLETE", "UNABLE_TO_CONTACT")).toBe(true);
    expect(validateSupportResolutionOutcome("SUPPORT_REQUEST", "SUBMIT_APPROVAL", "INTERNAL_OPERATIONAL_RESOLVED")).toBe(true);
    expect(validateSupportResolutionOutcome("SUPPORT_REQUEST", "APPROVE", undefined)).toBe(true);
    expect(validateSupportResolutionOutcome("GENERAL", "COMPLETE", undefined)).toBe(true);
    expect(validateSupportResolutionOutcome("GENERAL", "COMPLETE", "OTHER")).toBe(false);
    expect(staffTaskPatchSchema.safeParse({ expectedVersion: 1, action: "COMPLETE", supportResolutionOutcome: "INTERNAL_OPERATIONAL_RESOLVED" }).success).toBe(true);
    expect(staffTaskPatchSchema.safeParse({ expectedVersion: 1, action: "COMPLETE", supportResolutionOutcome: "MADE_UP" }).success).toBe(false);
  });
  it("accepts only typed operational references on tasks", () => {
    const base = { centreId: crypto.randomUUID(), assignedStaffId: crypto.randomUUID(), title: "Review appointment exception" };
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "APPOINTMENT", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "REPORT", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "REPORT_FOLLOWUP", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "PUBLIC_ENQUIRY", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "LEAD_FOLLOWUP", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "FINANCE_PAYMENT", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "FINANCE_REFUND", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "CORPORATE_RELATIONSHIP", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "PARTNER_RELATIONSHIP", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "DOCTOR_RELATIONSHIP", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "STAFF_ESCALATION", id: crypto.randomUUID() } }).success).toBe(true);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "PATIENT", id: crypto.randomUUID() } }).success).toBe(false);
    expect(staffTaskCreateSchema.safeParse({ ...base, reference: { type: "LEAD", id: "not-a-uuid" } }).success).toBe(false);
  });
  it("triggers a configured approval escalation once its due and only while the request is pending", () => {
    const now = new Date("2026-10-29T12:00:00.000Z");
    const base = { status: "AWAITING_APPROVAL", approvalStatus: "PENDING", dueAt: new Date("2026-10-29T11:59:00.000Z"), processedAt: null, ownerStaffId: "approver", assignedStaffId: "worker", createdByStaffId: "creator" };
    expect(canTriggerConfiguredApprovalEscalation(base, now)).toBe(true);
    expect(canTriggerConfiguredApprovalEscalation({ ...base, dueAt: new Date("2026-10-29T12:01:00.000Z") }, now)).toBe(false);
    expect(canTriggerConfiguredApprovalEscalation({ ...base, processedAt: now }, now)).toBe(false);
    expect(canTriggerConfiguredApprovalEscalation({ ...base, status: "IN_PROGRESS" }, now)).toBe(false);
    expect(canTriggerConfiguredApprovalEscalation({ ...base, ownerStaffId: "worker" }, now)).toBe(false);
  });
  it("rejects configured escalation owners who cannot independently review the task", () => {
    expect(approvalEscalationOwnerConflicts("worker", "worker", "creator")).toBe(true);
    expect(approvalEscalationOwnerConflicts("creator", "worker", "creator")).toBe(true);
    expect(approvalEscalationOwnerConflicts("independent-reviewer", "worker", "creator")).toBe(false);
    expect(approvalEscalationOwnerConflicts(null, "worker", "creator")).toBe(false);
  });
});
