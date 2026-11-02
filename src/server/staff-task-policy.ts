import { z } from "zod";
import type { PermissionGrant } from "@/server/permissions";
export { canUpdateTask } from "@/lib/task-permissions";

export const staffTaskPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const staffTaskTypes = ["GENERAL", "OPERATIONS", "FOLLOW_UP", "EXCEPTION_REVIEW", "SUPPORT_REQUEST"] as const;
export const supportResolutionOutcomes = ["CUSTOMER_CONFIRMED_RESOLVED", "INTERNAL_OPERATIONAL_RESOLVED", "REFERRED_TO_EXISTING_WORKFLOW", "UNABLE_TO_CONTACT", "OTHER"] as const;
export const staffTaskCreateSchema = z.object({
  centreId: z.uuid(), assignedStaffId: z.uuid(), title: z.string().trim().min(3).max(120), description: z.string().trim().max(1000).default(""),
  reference: z.object({ type: z.enum(["APPOINTMENT", "LEAD", "LEAD_FOLLOWUP", "PUBLIC_ENQUIRY", "COLLECTION_JOB", "SAMPLE_EXCEPTION", "REPORT", "REPORT_FOLLOWUP", "FINANCE_PAYMENT", "FINANCE_REFUND", "STAFF_TASK", "STAFF_ESCALATION", "CORPORATE_RELATIONSHIP", "PARTNER_RELATIONSHIP", "DOCTOR_RELATIONSHIP"]), id: z.uuid() }).nullable().default(null),
  taskType: z.enum(staffTaskTypes).default("GENERAL"), priority: z.enum(staffTaskPriorities).default("NORMAL"), dueAt: z.iso.datetime().nullable().default(null), requiresApproval: z.boolean().default(false),
});

export function taskQueueIsAssignedOnly(grants: readonly PermissionGrant[], centreId?: string) {
  const inScope = (grant: PermissionGrant) => centreId === undefined || grant.centreId === null || grant.centreId === centreId;
  const broadRead = grants.some((grant) => grant.key === "tasks.read" && inScope(grant));
  const assignedRead = grants.some((grant) => grant.key === "tasks.assigned.read" && inScope(grant));
  return assignedRead && !broadRead;
}

export const staffTaskPatchSchema = z.object({
  expectedVersion: z.number().int().positive(), action: z.enum(["UPDATE", "COMMENT", "START", "COMPLETE", "SUBMIT_APPROVAL", "APPROVE", "REJECT", "REQUEST_CHANGES", "EXPIRE_APPROVAL", "REASSIGN_ESCALATION", "REASSIGN_APPROVER", "TRIGGER_ESCALATION", "CANCEL", "REOPEN"]),
  supportResolutionOutcome: z.enum(supportResolutionOutcomes).optional(),
  title: z.string().trim().min(3).max(120).optional(), description: z.string().trim().max(1000).optional(), comment: z.string().trim().min(1).max(1000).optional(),
  assignedStaffId: z.uuid().optional(), approverStaffId: z.uuid().optional(), escalationOwnerStaffId: z.uuid().nullable().optional(), priority: z.enum(staffTaskPriorities).optional(), dueAt: z.iso.datetime().nullable().optional(), escalationDueAt: z.iso.datetime().nullable().optional(), reason: z.string().trim().min(3).max(240).optional(),
}).superRefine((data, ctx) => {
  if (["APPROVE", "REJECT", "REQUEST_CHANGES", "EXPIRE_APPROVAL", "REASSIGN_ESCALATION", "REASSIGN_APPROVER", "CANCEL", "REOPEN"].includes(data.action) && !data.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for this action." });
  if (data.action === "COMMENT" && !data.comment) ctx.addIssue({ code: "custom", path: ["comment"], message: "Add a comment." });
  if (data.action === "UPDATE" && ![data.title, data.description, data.assignedStaffId, data.priority, data.dueAt].some((value) => value !== undefined)) ctx.addIssue({ code: "custom", message: "Provide a task update." });
  if (data.action === "REASSIGN_ESCALATION" && (!data.escalationOwnerStaffId || !data.escalationDueAt)) ctx.addIssue({ code: "custom", message: "Choose an escalation owner and due date." });
  if (data.action === "REASSIGN_ESCALATION" && data.escalationDueAt && Date.parse(data.escalationDueAt) <= Date.now()) ctx.addIssue({ code: "custom", path: ["escalationDueAt"], message: "The new escalation due date must be in the future." });
  if (data.action === "REASSIGN_APPROVER" && !data.approverStaffId) ctx.addIssue({ code: "custom", path: ["approverStaffId"], message: "Choose an eligible approver." });
});

export function validateSupportResolutionOutcome(taskType: string, action: string, outcome: string | undefined) {
  if (taskType === "SUPPORT_REQUEST" && ["COMPLETE", "SUBMIT_APPROVAL"].includes(action)) return outcome !== undefined;
  return outcome === undefined;
}

export function canReadTask(grants: readonly PermissionGrant[], centreId: string, assignedStaffId: string, staffId: string, escalation?: { ownerStaffId: string | null; processedAt: Date | null; pending: boolean }, taskType?: string) {
  const broad = grants.some((grant) => grant.key === "tasks.read" && (grant.centreId === null || grant.centreId === centreId));
  const assigned = grants.some((grant) => grant.key === "tasks.assigned.read" && (grant.centreId === null || grant.centreId === centreId));
  const supportQueue = taskType === "SUPPORT_REQUEST" && grants.some((grant) => grant.key === "tasks.support.read" && (grant.centreId === null || grant.centreId === centreId));
  return broad || supportQueue || (assigned && (assignedStaffId === staffId || Boolean(escalation?.pending && escalation.processedAt && escalation.ownerStaffId === staffId)));
}

export function taskCentreReadScope(grants: readonly PermissionGrant[]): string[] | null {
  const scoped = grants.filter((grant) => grant.key === "tasks.read");
  if (scoped.some((grant) => grant.centreId === null)) return null;
  return [...new Set(scoped.map((grant) => grant.centreId).filter((centreId): centreId is string => centreId !== null))].sort();
}

export function taskCanTransition(status: string, action: string, requiresApproval: boolean, approvalStatus: string) {
  if (action === "START") return status === "OPEN";
  if (action === "COMPLETE") return !requiresApproval && ["OPEN", "IN_PROGRESS"].includes(status);
  if (action === "SUBMIT_APPROVAL") return requiresApproval && ["OPEN", "IN_PROGRESS"].includes(status) && approvalStatus !== "PENDING";
  if (action === "APPROVE" || action === "REJECT" || action === "REQUEST_CHANGES") return status === "AWAITING_APPROVAL" && approvalStatus === "PENDING";
  if (action === "REASSIGN_APPROVER") return status === "AWAITING_APPROVAL" && approvalStatus === "PENDING";
  if (action === "REASSIGN_ESCALATION") return status === "AWAITING_APPROVAL" && approvalStatus === "PENDING";
  if (action === "EXPIRE_APPROVAL") return status === "AWAITING_APPROVAL" && approvalStatus === "PENDING";
  if (action === "TRIGGER_ESCALATION") return status === "AWAITING_APPROVAL" && approvalStatus === "PENDING";
  if (action === "CANCEL") return !["COMPLETED", "CANCELLED"].includes(status);
  if (action === "REOPEN") return ["COMPLETED", "CANCELLED"].includes(status);
  if (action === "UPDATE") return !["COMPLETED", "CANCELLED"].includes(status);
  if (action === "COMMENT") return status !== "CANCELLED";
  return false;
}

/** A task requester or assignee cannot decide its completion approval. */
export function taskApprovalDecisionIsIndependent(actorStaffId: string, createdByStaffId: string, assignedStaffId: string) {
  return actorStaffId !== createdByStaffId && actorStaffId !== assignedStaffId;
}

export function independentTaskApproverIds(candidateStaffIds: readonly string[], createdByStaffId: string, assignedStaffId: string) {
  return candidateStaffIds.filter((staffId) => taskApprovalDecisionIsIndependent(staffId, createdByStaffId, assignedStaffId));
}

export function canTriggerConfiguredApprovalEscalation(input: { status: string; approvalStatus: string; dueAt: Date | null; processedAt: Date | null; ownerStaffId: string | null; assignedStaffId: string; createdByStaffId: string }, now = new Date()) {
  return input.status === "AWAITING_APPROVAL"
    && input.approvalStatus === "PENDING"
    && input.dueAt !== null
    && input.dueAt <= now
    && input.processedAt === null
    && input.ownerStaffId !== null
    && input.ownerStaffId !== input.assignedStaffId
    && input.ownerStaffId !== input.createdByStaffId;
}
