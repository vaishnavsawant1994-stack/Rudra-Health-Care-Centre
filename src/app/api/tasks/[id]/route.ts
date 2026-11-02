import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { permissions, rolePermissions, roles, staffApprovalPolicies, staffApprovalPolicyApprovers, staffRoleAssignments, staffTaskEvents, staffTasks, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { canReadTask, canTriggerConfiguredApprovalEscalation, canUpdateTask, independentTaskApproverIds, staffTaskPatchSchema, taskApprovalDecisionIsIndependent, taskCanTransition, validateSupportResolutionOutcome } from "@/server/staff-task-policy";
import { approvalEscalationOwnerConflicts, canRequestTaskApproval, getApprovalEscalationDueAt, getApprovalExpiryAt, isNamedApproverEligible, readApprovalSubmissionSnapshot } from "@/server/staff-approval-policy";
import { resolveTaskReference, type TaskReference } from "@/server/task-reference";
import { legacyTaskActionFingerprint, sameTaskActionPrivateData, taskActionFingerprint } from "@/server/staff-task-idempotency";

const uuid = z.uuid();
type PrivateTask = { title: string; description: string; reference?: (TaskReference & { label: string }) | null };
type TaskActionResult = { id: string; versionNumber: number; status: string; approvalStatus: string };
const taskContext = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "staff-task");
const eventContext = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "staff-task-event");

async function readAccess(centreId: string) {
  const broad = await getApiAccess("tasks.read", centreId);
  if (!broad.response) return broad;
  const assigned = await getApiAccess("tasks.assigned.read", centreId);
  if (!assigned.response) return assigned;
  const support = await getApiAccess("tasks.support.read", centreId);
  return support.response ? broad : support;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const initial = await getApiAccess("workspace.read");
  if (initial.response) return initial.response;
  const lookup = await getDb().select({ id: staffTasks.id, organizationId: staffTasks.organizationId, centreId: staffTasks.centreId, taskNumber: staffTasks.taskNumber, privateDataCiphertext: staffTasks.privateDataCiphertext, taskType: staffTasks.taskType, priority: staffTasks.priority, status: staffTasks.status, requiresApproval: staffTasks.requiresApproval, approvalStatus: staffTasks.approvalStatus, approvalPolicyId: staffTasks.approvalPolicyId, approvalExpiresAt: staffTasks.approvalExpiresAt, escalationOwnerStaffId: staffTasks.escalationOwnerStaffId, escalationDueAt: staffTasks.escalationDueAt, escalationProcessedAt: staffTasks.escalationProcessedAt, assignedStaffId: staffTasks.assignedStaffId, assignedStaffName: staffUsers.displayName, createdByStaffId: staffTasks.createdByStaffId, dueAt: staffTasks.dueAt, versionNumber: staffTasks.versionNumber, createdAt: staffTasks.createdAt, updatedAt: staffTasks.updatedAt })
    .from(staffTasks).innerJoin(staffUsers, and(eq(staffUsers.id, staffTasks.assignedStaffId), eq(staffUsers.organizationId, staffTasks.organizationId))).where(and(eq(staffTasks.id, id), eq(staffTasks.organizationId, initial.staff.organizationId))).limit(1);
  const task = lookup[0];
  if (!task) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await readAccess(task.centreId);
  if (access.response || !canReadTask(access.staff.grants, task.centreId, task.assignedStaffId, access.staff.staffUserId, { ownerStaffId: task.escalationOwnerStaffId, processedAt: task.escalationProcessedAt, pending: task.status === "AWAITING_APPROVAL" && task.approvalStatus === "PENDING" }, task.taskType)) return Response.json({ error: "not_found" }, { status: 404 });
  const events = await getDb().select({ id: staffTaskEvents.id, eventType: staffTaskEvents.eventType, privateDataCiphertext: staffTaskEvents.privateDataCiphertext, actorType: staffTaskEvents.actorType, actorStaffId: staffTaskEvents.actorStaffId, actorName: staffUsers.displayName, recordedAt: staffTaskEvents.recordedAt }).from(staffTaskEvents).leftJoin(staffUsers, and(eq(staffUsers.id, staffTaskEvents.actorStaffId), eq(staffUsers.organizationId, staffTaskEvents.organizationId))).where(and(eq(staffTaskEvents.organizationId, task.organizationId), eq(staffTaskEvents.centreId, task.centreId), eq(staffTaskEvents.taskId, id))).orderBy(asc(staffTaskEvents.recordedAt));
  let escalationApprovers: Array<{ id: string; displayName: string; staffCode: string }> | undefined;
  let reassignableApprovers: Array<{ id: string; displayName: string; staffCode: string }> | undefined;
  const hasCentreGrant = (permission: string) => access.staff.grants.some((grant) => grant.key === permission && (grant.centreId === null || grant.centreId === task.centreId));
  let activeApproverRows: Array<{ id: string; displayName: string; staffCode: string }> | undefined;
  const submittedForApproval = [...events].reverse().find((event) => event.eventType === "SUBMITTED_FOR_APPROVAL");
  let submittedSnapshot: ReturnType<typeof readApprovalSubmissionSnapshot> | undefined;
  if (submittedForApproval) {
    try {
      const submittedData = decryptOperationalData<Record<string, unknown>>(submittedForApproval.privateDataCiphertext, eventContext(task.organizationId, task.centreId, submittedForApproval.id));
      submittedSnapshot = readApprovalSubmissionSnapshot(submittedData);
      if (submittedSnapshot?.policyId !== task.approvalPolicyId) submittedSnapshot = undefined;
    } catch {
      submittedSnapshot = undefined;
    }
  }
  if (task.status === "AWAITING_APPROVAL" && task.approvalStatus === "PENDING" && hasCentreGrant("tasks.assign") && hasCentreGrant("tasks.approve") && submittedSnapshot && (submittedSnapshot.approverStaffIds.length > 0 || Boolean(task.escalationDueAt))) {
    activeApproverRows = await getDb().selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode }).from(staffUsers)
      .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
      .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(staffUsers.organizationId, task.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, task.centreId), isNull(staffRoleAssignments.centreId)), eq(permissions.key, "tasks.approve")))
      .orderBy(staffUsers.displayName).limit(200);
    const frozenApproverIds = submittedSnapshot.approverStaffIds;
    const frozenEligible = frozenApproverIds.length ? activeApproverRows.filter((person) => frozenApproverIds.includes(person.id)) : activeApproverRows;
    if (task.escalationDueAt) escalationApprovers = frozenEligible.filter((person) => person.id !== task.assignedStaffId && person.id !== task.createdByStaffId);
    // Permit recovery only when the immutable reviewer snapshot has no active,
    // centre-scoped reviewer left. Never turn a routine reassignment control
    // into a way to replace a still-eligible reviewer.
    if (frozenApproverIds.length > 0 && frozenEligible.length === 0) reassignableApprovers = activeApproverRows.filter((person) => person.id !== task.assignedStaffId && person.id !== task.createdByStaffId);
  }
  if (task.status === "AWAITING_APPROVAL" && task.approvalStatus === "PENDING" && task.escalationDueAt && hasCentreGrant("tasks.assign") && hasCentreGrant("tasks.approve")) {
    let namedApproverIds: string[] | undefined = submittedSnapshot?.approverStaffIds;
    const submissionSnapshotInvalid = Boolean(submittedForApproval && !submittedSnapshot);
    if (namedApproverIds === undefined && !submissionSnapshotInvalid) {
      const [policy] = await getDb().select({ id: staffApprovalPolicies.id }).from(staffApprovalPolicies)
        .where(and(eq(staffApprovalPolicies.organizationId, task.organizationId), eq(staffApprovalPolicies.actionType, "TASK_COMPLETION"), or(eq(staffApprovalPolicies.centreId, task.centreId), isNull(staffApprovalPolicies.centreId))))
        .orderBy(sql`CASE WHEN ${staffApprovalPolicies.centreId} = ${task.centreId} THEN 0 ELSE 1 END`).limit(1);
      namedApproverIds = policy ? (await getDb().select({ staffId: staffApprovalPolicyApprovers.staffId }).from(staffApprovalPolicyApprovers).where(and(eq(staffApprovalPolicyApprovers.organizationId, task.organizationId), eq(staffApprovalPolicyApprovers.policyId, policy.id)))).map((row) => row.staffId) : [];
    }
    const approverConditions = [eq(staffUsers.organizationId, task.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, task.centreId), isNull(staffRoleAssignments.centreId)), eq(permissions.key, "tasks.approve")];
    if (submissionSnapshotInvalid) {
      escalationApprovers = [];
    } else {
      const eligibleApproverIds = namedApproverIds ?? [];
      if (eligibleApproverIds.length) approverConditions.push(inArray(staffUsers.id, eligibleApproverIds));
      const eligible = activeApproverRows ?? await getDb().selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode }).from(staffUsers)
        .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
        .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(and(...approverConditions)).orderBy(staffUsers.displayName).limit(200);
      escalationApprovers = eligible.filter((person) => (!eligibleApproverIds.length || eligibleApproverIds.includes(person.id)) && person.id !== task.assignedStaffId && person.id !== task.createdByStaffId);
    }
  }
  const { privateDataCiphertext, organizationId, ...publicTask } = task;
  const privateData = decryptOperationalData<PrivateTask>(privateDataCiphertext, taskContext(organizationId, task.centreId, id));
  if (privateData.reference && !await resolveTaskReference(access.staff, task.centreId, privateData.reference)) privateData.reference = null;
  const reassignedApproverIds = new Set<string>();
  const reassignedApproverByEventId = new Map<string, string>();
  const history = events.map(({ privateDataCiphertext: envelope, ...event }) => {
    const details = decryptOperationalData<Record<string, unknown>>(envelope, eventContext(task.organizationId, task.centreId, event.id));
    const visibleDetails = { ...details };
    delete visibleDetails.idempotencyResult;
    delete visibleDetails.approvalSnapshotVersion;
    delete visibleDetails.approvalPolicyId;
    delete visibleDetails.approvalPolicyVersion;
    delete visibleDetails.approvalApproverStaffIds;
    if (event.eventType === "APPROVER_REASSIGNED" && typeof visibleDetails.approverStaffId === "string") { reassignedApproverIds.add(visibleDetails.approverStaffId); reassignedApproverByEventId.set(event.id, visibleDetails.approverStaffId); }
    delete visibleDetails.approverStaffId;
    return { ...event, ...visibleDetails };
  });
  const approverLabels = reassignedApproverIds.size
    ? await getDb().select({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode }).from(staffUsers).where(and(eq(staffUsers.organizationId, task.organizationId), inArray(staffUsers.id, [...reassignedApproverIds])))
    : [];
  const approverLabelById = new Map(approverLabels.map((person) => [person.id, `${person.displayName} (${person.staffCode})`]));
  const historyWithApprover = history.map((event) => event.eventType === "APPROVER_REASSIGNED"
    ? { ...event, approverName: approverLabelById.get(reassignedApproverByEventId.get(event.id) ?? "") ?? "Unavailable staff record" }
    : event);
  return Response.json({ task: { ...publicTask, ...privateData, ...(escalationApprovers ? { escalationApprovers } : {}), ...(reassignableApprovers ? { reassignableApprovers } : {}) }, history: historyWithApprover });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = staffTaskPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_task_action", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!uuid.safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const initial = await getApiAccess("workspace.read");
  if (initial.response) return initial.response;
  const orgId = initial.staff.organizationId;
  const idempotencyPayload = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => key !== "expectedVersion"));
  const requestHash = taskActionFingerprint(id, initial.staff.staffUserId, idempotencyPayload);
  const legacyRequestHash = legacyTaskActionFingerprint(id, initial.staff.staffUserId, idempotencyPayload);
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${orgId}:staff-task-action:${idempotencyKey}`}, 0))`);
      const [replay] = await tx.select().from(staffTaskEvents).where(and(eq(staffTaskEvents.organizationId, orgId), eq(staffTaskEvents.idempotencyKey, idempotencyKey!))).limit(1);
      if (replay) {
        if (replay.taskId !== id || (replay.requestHash !== requestHash && replay.requestHash !== legacyRequestHash)) throw new Error("idempotency_conflict");
        const [replayTask] = await tx.select().from(staffTasks).where(and(eq(staffTasks.id, id), eq(staffTasks.organizationId, orgId))).limit(1);
        if (!replayTask) throw new Error("not_found");
        const replayAccess = await readAccess(replayTask.centreId);
        if (replayAccess.response || !canReadTask(replayAccess.staff.grants, replayTask.centreId, replayTask.assignedStaffId, replayAccess.staff.staffUserId, { ownerStaffId: replayTask.escalationOwnerStaffId, processedAt: replayTask.escalationProcessedAt, pending: replayTask.status === "AWAITING_APPROVAL" && replayTask.approvalStatus === "PENDING" }, replayTask.taskType)) throw new Error("not_found");
        await assertTaskActionPermission(replayTask, replayAccess.staff, parsed.data.action, parsed.data.assignedStaffId);
        const eventData = decryptOperationalData<Record<string, unknown>>(replay.privateDataCiphertext, eventContext(replay.organizationId, replay.centreId, replay.id));
        if (eventData.privateRequest && !sameTaskActionPrivateData(eventData.privateRequest, idempotencyPayload)) throw new Error("idempotency_conflict");
        if (!eventData.privateRequest && replay.requestHash !== legacyRequestHash) throw new Error("idempotency_conflict");
        const snapshot = eventData.idempotencyResult;
        if (!snapshot || typeof snapshot !== "object") throw new Error("idempotency_result_unavailable");
        return { task: snapshot as TaskActionResult, replayed: true };
      }
      const [task] = await tx.select().from(staffTasks).where(and(eq(staffTasks.id, id), eq(staffTasks.organizationId, orgId))).for("update").limit(1);
      if (!task) throw new Error("not_found");
      const access = await readAccess(task.centreId);
      if (access.response || !canReadTask(access.staff.grants, task.centreId, task.assignedStaffId, access.staff.staffUserId, { ownerStaffId: task.escalationOwnerStaffId, processedAt: task.escalationProcessedAt, pending: task.status === "AWAITING_APPROVAL" && task.approvalStatus === "PENDING" }, task.taskType)) throw new Error("not_found");
      const actor = access.staff;
      const action = parsed.data.action;
      await assertTaskActionPermission(task, actor, action, parsed.data.assignedStaffId);
      if (!validateSupportResolutionOutcome(task.taskType, action, parsed.data.supportResolutionOutcome)) throw new Error("support_resolution_outcome_required_or_unexpected");
      if (task.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
      if (!taskCanTransition(task.status, action, task.requiresApproval, task.approvalStatus)) throw new Error("invalid_transition");

      let approvalPolicy: typeof staffApprovalPolicies.$inferSelect | undefined;
      let submittedSupportOutcome: string | undefined;
      if (action !== "SUBMIT_APPROVAL" && task.approvalPolicyId) {
        const policyQuery = tx.select().from(staffApprovalPolicies).where(and(eq(staffApprovalPolicies.id, task.approvalPolicyId), eq(staffApprovalPolicies.organizationId, orgId)));
        approvalPolicy = (await policyQuery.limit(1))[0];
      }
      if (!approvalPolicy && ["SUBMIT_APPROVAL", "APPROVE", "REJECT", "REQUEST_CHANGES", "EXPIRE_APPROVAL", "REASSIGN_ESCALATION", "REASSIGN_APPROVER", "TRIGGER_ESCALATION"].includes(action)) {
        const policyQuery = tx.select().from(staffApprovalPolicies).where(and(eq(staffApprovalPolicies.organizationId, orgId), eq(staffApprovalPolicies.actionType, "TASK_COMPLETION"), or(eq(staffApprovalPolicies.centreId, task.centreId), isNull(staffApprovalPolicies.centreId)))).orderBy(sql`CASE WHEN ${staffApprovalPolicies.centreId} = ${task.centreId} THEN 0 ELSE 1 END`);
        approvalPolicy = (action === "SUBMIT_APPROVAL" ? await policyQuery.for("share").limit(1) : await policyQuery.limit(1))[0];
      }
      if (action === "SUBMIT_APPROVAL" && !canRequestTaskApproval(approvalPolicy)) throw new Error("approval_policy_unavailable");
      if (action === "SUBMIT_APPROVAL" && approvalPolicy?.escalationAfterMinutes !== null && approvalPolicy?.escalationAfterMinutes !== undefined && approvalEscalationOwnerConflicts(approvalPolicy.escalationOwnerStaffId, task.assignedStaffId, task.createdByStaffId)) throw new Error("escalation_owner_conflict");
      let submissionApproverIds: string[] | undefined;
      if (action === "SUBMIT_APPROVAL" && approvalPolicy) {
        const configuredApprovers = (await tx.select({ staffId: staffApprovalPolicyApprovers.staffId }).from(staffApprovalPolicyApprovers).where(and(eq(staffApprovalPolicyApprovers.organizationId, orgId), eq(staffApprovalPolicyApprovers.policyId, approvalPolicy.id)))).map((item) => item.staffId);
        const currentlyEligible = await tx.select({ id: staffUsers.id }).from(staffUsers)
          .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
          .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId))
          .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "tasks.approve")))
          .where(and(eq(staffUsers.organizationId, orgId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, task.centreId), isNull(staffRoleAssignments.centreId))))
          .for("share");
        const eligibleIds = new Set(currentlyEligible.map((row) => row.id));
        // Freeze only independent reviewers. A policy may still contain an
        // author/assignee from earlier configuration, but that person must not
        // become eligible to decide this task's own completion request.
        submissionApproverIds = configuredApprovers.length
          ? independentTaskApproverIds(configuredApprovers.filter((staffId) => eligibleIds.has(staffId)), task.createdByStaffId, task.assignedStaffId)
          : independentTaskApproverIds(currentlyEligible.map((row) => row.id), task.createdByStaffId, task.assignedStaffId);
        if (configuredApprovers.length && submissionApproverIds.length === 0) throw new Error("approval_policy_approver_unavailable");
        if (!configuredApprovers.length && eligibleIds.size === 0) throw new Error("approval_policy_approver_unavailable");
        if (approvalPolicy.escalationAfterMinutes !== null && (!approvalPolicy.escalationOwnerStaffId || !eligibleIds.has(approvalPolicy.escalationOwnerStaffId))) throw new Error("approval_policy_approver_unavailable");
      }
      if (["APPROVE", "REJECT", "REQUEST_CHANGES", "EXPIRE_APPROVAL"].includes(action) || action === "REASSIGN_ESCALATION" || action === "REASSIGN_APPROVER") {
        if (!approvalPolicy) throw new Error("approval_policy_unavailable");
        const [submissionEvent] = await tx.select({ id: staffTaskEvents.id, privateDataCiphertext: staffTaskEvents.privateDataCiphertext }).from(staffTaskEvents).where(and(eq(staffTaskEvents.organizationId, task.organizationId), eq(staffTaskEvents.centreId, task.centreId), eq(staffTaskEvents.taskId, task.id), eq(staffTaskEvents.eventType, "SUBMITTED_FOR_APPROVAL"))).orderBy(desc(staffTaskEvents.recordedAt), desc(staffTaskEvents.id)).limit(1);
        const submissionData = submissionEvent ? decryptOperationalData<Record<string, unknown>>(submissionEvent.privateDataCiphertext, eventContext(task.organizationId, task.centreId, submissionEvent.id)) : undefined;
        if (task.taskType === "SUPPORT_REQUEST") {
          const knownOutcomes = ["CUSTOMER_CONFIRMED_RESOLVED", "INTERNAL_OPERATIONAL_RESOLVED", "REFERRED_TO_EXISTING_WORKFLOW", "UNABLE_TO_CONTACT", "OTHER"];
          if (typeof submissionData?.supportResolutionOutcome !== "string" || !knownOutcomes.includes(submissionData.supportResolutionOutcome)) throw new Error("support_resolution_outcome_required_or_unexpected");
          submittedSupportOutcome = submissionData.supportResolutionOutcome;
        }
        const snapshot = readApprovalSubmissionSnapshot(submissionData);
        if (snapshot && snapshot.policyId !== approvalPolicy.id) throw new Error("approval_snapshot_invalid");
        submissionApproverIds = snapshot?.approverStaffIds;
        if (!submissionEvent) throw new Error("approval_snapshot_invalid");
        let reassignedApproverIds: string[] | undefined;
        const reassignmentEvents = await tx.select({ id: staffTaskEvents.id, privateDataCiphertext: staffTaskEvents.privateDataCiphertext }).from(staffTaskEvents)
          .where(and(eq(staffTaskEvents.organizationId, task.organizationId), eq(staffTaskEvents.centreId, task.centreId), eq(staffTaskEvents.taskId, task.id), eq(staffTaskEvents.eventType, "APPROVER_REASSIGNED")))
          .orderBy(desc(staffTaskEvents.recordedAt), desc(staffTaskEvents.id)).limit(50);
        for (const event of reassignmentEvents) {
          const details = decryptOperationalData<Record<string, unknown>>(event.privateDataCiphertext, eventContext(task.organizationId, task.centreId, event.id));
          if (details.submissionEventId === submissionEvent.id) {
            if (typeof details.approverStaffId !== "string" || !z.uuid().safeParse(details.approverStaffId).success) throw new Error("approval_snapshot_invalid");
            reassignedApproverIds = [details.approverStaffId];
            break;
          }
        }
        const allowedIds = reassignedApproverIds ?? submissionApproverIds ?? (await tx.select({ staffId: staffApprovalPolicyApprovers.staffId }).from(staffApprovalPolicyApprovers).where(and(eq(staffApprovalPolicyApprovers.organizationId, orgId), eq(staffApprovalPolicyApprovers.policyId, approvalPolicy.id)))).map((item) => item.staffId);
        if (action === "REASSIGN_ESCALATION" && approvalEscalationOwnerConflicts(parsed.data.escalationOwnerStaffId ?? null, task.assignedStaffId, task.createdByStaffId)) throw new Error("escalation_owner_conflict");
        if (action === "REASSIGN_APPROVER" && allowedIds.length === 0) throw new Error("approver_reassignment_not_required");
        const escalationOwnerMayDecide = action !== "REASSIGN_ESCALATION"
          && task.escalationProcessedAt !== null
          && task.escalationOwnerStaffId === actor.staffUserId;
        if (action !== "REASSIGN_APPROVER" && !isNamedApproverEligible(allowedIds, action === "REASSIGN_ESCALATION" ? parsed.data.escalationOwnerStaffId ?? "" : actor.staffUserId) && !escalationOwnerMayDecide) throw new Error("approver_not_eligible");
        if (action === "REASSIGN_APPROVER") {
          if (task.status !== "AWAITING_APPROVAL" || task.approvalStatus !== "PENDING") throw new Error("invalid_transition");
          const [stillEligibleReviewer] = allowedIds.length ? await tx.select({ id: staffUsers.id }).from(staffUsers)
            .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
            .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
            .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "tasks.approve")))
            .where(and(eq(staffUsers.organizationId, orgId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, task.centreId), isNull(staffRoleAssignments.centreId)), inArray(staffUsers.id, allowedIds)))
            .for("share").limit(1) : [];
          if (stillEligibleReviewer) throw new Error("approver_reassignment_not_required");
          const [eligibleTarget] = await tx.select({ id: staffUsers.id }).from(staffUsers)
            .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
            .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
            .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "tasks.approve")))
            .where(and(eq(staffUsers.id, parsed.data.approverStaffId!), eq(staffUsers.organizationId, orgId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, task.centreId), isNull(staffRoleAssignments.centreId))))
            .for("share").limit(1);
          if (!eligibleTarget) throw new Error("approver_not_eligible");
          if (parsed.data.approverStaffId === task.createdByStaffId || parsed.data.approverStaffId === task.assignedStaffId) throw new Error("separation_of_duties");
        }
      }
      if (["APPROVE", "REJECT", "REQUEST_CHANGES"].includes(action) && task.approvalExpiresAt && task.approvalExpiresAt <= new Date()) throw new Error("approval_expiry_due");
      if (action === "EXPIRE_APPROVAL" && (!task.approvalExpiresAt || task.approvalExpiresAt > new Date())) throw new Error("approval_expiry_not_due");
      if (action === "EXPIRE_APPROVAL" && (actor.staffUserId === task.createdByStaffId || actor.staffUserId === task.assignedStaffId)) throw new Error("separation_of_duties");

      let nextPrivate: PrivateTask = decryptOperationalData(task.privateDataCiphertext, taskContext(task.organizationId, task.centreId, task.id));
      if (parsed.data.title !== undefined) nextPrivate = { ...nextPrivate, title: parsed.data.title };
      if (parsed.data.description !== undefined) nextPrivate = { ...nextPrivate, description: parsed.data.description };
      const eventData: Record<string, unknown> = {};
      let eventType: string = action;
      const set: Partial<typeof staffTasks.$inferInsert> = { versionNumber: task.versionNumber + 1, updatedAt: new Date() };
      if (action === "START") { set.status = "IN_PROGRESS"; eventType = "STARTED"; }
      if (action === "COMPLETE") { set.status = "COMPLETED"; eventType = "COMPLETED"; }
      if (action === "SUBMIT_APPROVAL") {
        set.status = "AWAITING_APPROVAL"; set.approvalStatus = "PENDING"; set.approvalPolicyId = approvalPolicy!.id; eventType = "SUBMITTED_FOR_APPROVAL";
        eventData.approvalSnapshotVersion = 1; eventData.approvalPolicyId = approvalPolicy!.id; eventData.approvalPolicyVersion = approvalPolicy!.versionNumber; eventData.approvalApproverStaffIds = submissionApproverIds ?? [];
        set.escalationProcessedAt = null;
        set.approvalExpiresAt = getApprovalExpiryAt(new Date(), approvalPolicy!.expireAfterMinutes);
        if (approvalPolicy!.escalationAfterMinutes !== null && approvalPolicy!.escalationOwnerStaffId) {
          const escalationDueAt = getApprovalEscalationDueAt(new Date(), approvalPolicy!.escalationAfterMinutes)!;
          set.escalationOwnerStaffId = approvalPolicy!.escalationOwnerStaffId; set.escalationDueAt = escalationDueAt;
          eventData.escalationOwnerStaffId = approvalPolicy!.escalationOwnerStaffId; eventData.escalationDueAt = escalationDueAt.toISOString();
        }
      }
      if (action === "APPROVE") { set.status = "COMPLETED"; set.approvalStatus = "APPROVED"; set.approvedByStaffId = actor.staffUserId; set.approvedAt = new Date(); set.approvalExpiresAt = null; set.escalationOwnerStaffId = null; set.escalationDueAt = null; eventType = "APPROVED"; }
      if (action === "REJECT") { set.status = "IN_PROGRESS"; set.approvalStatus = "REJECTED"; set.approvalExpiresAt = null; set.escalationOwnerStaffId = null; set.escalationDueAt = null; eventType = "REJECTED"; }
      if (action === "REQUEST_CHANGES") { set.status = "IN_PROGRESS"; set.approvalStatus = "CHANGES_REQUESTED"; set.approvalExpiresAt = null; set.escalationOwnerStaffId = null; set.escalationDueAt = null; eventType = "CHANGES_REQUESTED"; }
      if (action === "EXPIRE_APPROVAL") { set.status = "IN_PROGRESS"; set.approvalStatus = "EXPIRED"; set.approvalExpiresAt = null; set.escalationOwnerStaffId = null; set.escalationDueAt = null; eventType = "APPROVAL_EXPIRED"; }
      if (action === "REASSIGN_ESCALATION") {
        // Allow a scoped supervisor to repair an unavailable/inappropriate owner
        // before the deadline as well as after it. This changes only the pending
        // escalation assignment/deadline; it does not approve the task.
        if (task.status !== "AWAITING_APPROVAL" || task.approvalStatus !== "PENDING" || !task.escalationDueAt) throw new Error("escalation_not_due");
        if (approvalEscalationOwnerConflicts(parsed.data.escalationOwnerStaffId ?? null, task.assignedStaffId, task.createdByStaffId)) throw new Error("escalation_owner_conflict");
        const [assignee] = await tx.select({ id: staffUsers.id }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt))).innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "tasks.approve"))).where(and(eq(staffUsers.id, parsed.data.escalationOwnerStaffId!), eq(staffUsers.organizationId, orgId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, task.centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
        if (!assignee) throw new Error("approver_not_eligible");
        set.escalationOwnerStaffId = parsed.data.escalationOwnerStaffId!; set.escalationDueAt = new Date(parsed.data.escalationDueAt!); set.escalationProcessedAt = null; eventType = "ESCALATION_REASSIGNED"; eventData.escalationOwnerStaffId = parsed.data.escalationOwnerStaffId!; eventData.escalationDueAt = parsed.data.escalationDueAt!;
      }
      if (action === "REASSIGN_APPROVER") {
        if (!approvalPolicy || task.status !== "AWAITING_APPROVAL" || task.approvalStatus !== "PENDING") throw new Error("invalid_transition");
        const [submissionEvent] = await tx.select({ id: staffTaskEvents.id }).from(staffTaskEvents).where(and(eq(staffTaskEvents.organizationId, task.organizationId), eq(staffTaskEvents.centreId, task.centreId), eq(staffTaskEvents.taskId, task.id), eq(staffTaskEvents.eventType, "SUBMITTED_FOR_APPROVAL"))).orderBy(desc(staffTaskEvents.recordedAt), desc(staffTaskEvents.id)).limit(1);
        if (!submissionEvent) throw new Error("approval_snapshot_invalid");
        eventData.submissionEventId = submissionEvent.id;
        eventData.approverStaffId = parsed.data.approverStaffId;
        eventType = "APPROVER_REASSIGNED";
      }
      if (action === "TRIGGER_ESCALATION") {
        const now = new Date();
        if (!canTriggerConfiguredApprovalEscalation({ status: task.status, approvalStatus: task.approvalStatus, dueAt: task.escalationDueAt, processedAt: task.escalationProcessedAt, ownerStaffId: task.escalationOwnerStaffId, assignedStaffId: task.assignedStaffId, createdByStaffId: task.createdByStaffId }, now)) throw new Error(task.escalationOwnerStaffId === task.assignedStaffId || task.escalationOwnerStaffId === task.createdByStaffId ? "escalation_owner_conflict" : "escalation_not_due");
        const escalationOwnerStaffId = task.escalationOwnerStaffId;
        const escalationDueAt = task.escalationDueAt;
        if (!escalationOwnerStaffId || !escalationDueAt) throw new Error("escalation_not_due");
        const [eligibleOwner] = await tx.select({ id: staffUsers.id }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt))).innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "tasks.approve"))).where(and(eq(staffUsers.id, escalationOwnerStaffId), eq(staffUsers.organizationId, orgId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, task.centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
        if (!eligibleOwner) throw new Error("approver_not_eligible");
        set.escalationProcessedAt = now; eventType = "ESCALATED"; eventData.escalationOwnerStaffId = escalationOwnerStaffId; eventData.escalationDueAt = escalationDueAt.toISOString();
      }
      if (action === "CANCEL") { set.status = "CANCELLED"; set.approvalStatus = "NOT_REQUIRED"; set.approvalExpiresAt = null; set.escalationOwnerStaffId = null; set.escalationDueAt = null; eventType = "CANCELLED"; }
      if (action === "REOPEN") { set.status = "OPEN"; set.approvalStatus = "NOT_REQUIRED"; set.approvalExpiresAt = null; set.approvedByStaffId = null; set.approvedAt = null; set.escalationOwnerStaffId = null; set.escalationDueAt = null; eventType = "REOPENED"; }
      if (action === "UPDATE") {
        if (parsed.data.priority !== undefined) set.priority = parsed.data.priority;
        if (parsed.data.dueAt !== undefined) set.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
        if (parsed.data.assignedStaffId !== undefined) {
          const [assignee] = await tx.select({ id: staffUsers.id }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt))).where(and(eq(staffUsers.id, parsed.data.assignedStaffId), eq(staffUsers.organizationId, orgId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, task.centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
          if (!assignee) throw new Error("assignee_not_found");
          if (parsed.data.assignedStaffId !== task.assignedStaffId) { set.assignedStaffId = parsed.data.assignedStaffId; eventType = "REASSIGNED"; }
        }
        if (parsed.data.title !== undefined || parsed.data.description !== undefined) set.privateDataCiphertext = encryptOperationalData(nextPrivate, taskContext(task.organizationId, task.centreId, task.id));
        eventType = eventType === "REASSIGNED" ? eventType : "UPDATED";
      }
      if (action === "COMMENT") { eventType = "COMMENTED"; eventData.comment = parsed.data.comment ?? null; }
      if (parsed.data.reason) eventData.reason = parsed.data.reason;
      if (task.taskType === "SUPPORT_REQUEST" && (action === "COMPLETE" || action === "SUBMIT_APPROVAL")) eventData.supportResolutionOutcome = parsed.data.supportResolutionOutcome;
      if (task.taskType === "SUPPORT_REQUEST" && action === "APPROVE") eventData.supportResolutionOutcome = submittedSupportOutcome;
      eventData.privateRequest = { title: parsed.data.title ?? null, description: parsed.data.description ?? null, comment: parsed.data.comment ?? null, reason: parsed.data.reason ?? null, supportResolutionOutcome: parsed.data.supportResolutionOutcome ?? null };
      if (action === "UPDATE" && eventType === "REASSIGNED") eventData.assignedStaffId = parsed.data.assignedStaffId ?? null;
      const [updated] = await tx.update(staffTasks).set(set).where(and(eq(staffTasks.id, task.id), eq(staffTasks.organizationId, orgId), eq(staffTasks.versionNumber, task.versionNumber))).returning({ id: staffTasks.id, versionNumber: staffTasks.versionNumber, status: staffTasks.status, approvalStatus: staffTasks.approvalStatus });
      if (!updated) throw new Error("version_conflict");
      eventData.idempotencyResult = updated;
      const eventId = randomUUID();
      await tx.insert(staffTaskEvents).values({ id: eventId, organizationId: task.organizationId, centreId: task.centreId, taskId: task.id, eventType, privateDataCiphertext: encryptOperationalData(eventData, eventContext(task.organizationId, task.centreId, eventId)), actorStaffId: actor.staffUserId, idempotencyKey, requestHash });
      await appendAuditEvent(tx, { organizationId: orgId, centreId: task.centreId, actorStaffId: actor.staffUserId, action: `staff_task.${eventType.toLowerCase()}`, entityType: "staff_task", entityId: task.id, details: { version: updated.versionNumber } });
      return { task: updated, replayed: false };
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "task_action_failed";
    const status = message === "not_found" ? 404 : message === "forbidden" ? 403 : message === "approver_not_eligible" ? 403 : message === "separation_of_duties" ? 403 : message === "version_conflict" || message === "idempotency_conflict" ? 409 : message === "invalid_transition" || message === "approval_policy_unavailable" || message === "approval_policy_approver_unavailable" || message === "approval_snapshot_invalid" || message === "approver_reassignment_not_required" || message === "escalation_not_due" || message === "escalation_owner_conflict" || message === "approval_expiry_due" || message === "approval_expiry_not_due" ? 409 : message === "assignee_not_found" || message === "support_resolution_outcome_required_or_unexpected" ? 400 : 500;
    return Response.json({ error: status === 500 ? "task_action_failed" : message }, { status });
  }
}

async function assertTaskActionPermission(task: typeof staffTasks.$inferSelect, actor: NonNullable<Awaited<ReturnType<typeof readAccess>>["staff"]>, action: string, requestedAssignee?: string) {
  if (["APPROVE", "REJECT", "REQUEST_CHANGES", "EXPIRE_APPROVAL"].includes(action)) {
    const approval = await getApiAccess("tasks.approve", task.centreId);
    if (approval.response) throw new Error("forbidden");
    if (!taskApprovalDecisionIsIndependent(actor.staffUserId, task.createdByStaffId, task.assignedStaffId)) throw new Error("separation_of_duties");
  } else if (action === "REASSIGN_ESCALATION" || action === "REASSIGN_APPROVER") {
    const assign = await getApiAccess("tasks.assign", task.centreId);
    if (assign.response) throw new Error("forbidden");
    const approval = await getApiAccess("tasks.approve", task.centreId);
    if (approval.response) throw new Error("forbidden");
    if (!taskApprovalDecisionIsIndependent(actor.staffUserId, task.createdByStaffId, task.assignedStaffId)) throw new Error("separation_of_duties");
  } else if (action === "TRIGGER_ESCALATION") {
    const approval = await getApiAccess("tasks.approve", task.centreId);
    if (approval.response) throw new Error("forbidden");
  } else if (action === "UPDATE" && requestedAssignee && requestedAssignee !== task.assignedStaffId) {
    const assign = await getApiAccess("tasks.assign", task.centreId);
    const supportManage = task.taskType === "SUPPORT_REQUEST" && actor.grants.some((grant) => grant.key === "tasks.support.manage" && (grant.centreId === null || grant.centreId === task.centreId));
    if (assign.response && !supportManage) throw new Error("forbidden");
    if (!canUpdateTask(actor.grants, task.centreId, task.assignedStaffId, actor.staffUserId, task.taskType)) throw new Error("forbidden");
  } else {
    const updateAccess = await getApiAccess("tasks.update", task.centreId);
    if (updateAccess.response || !canUpdateTask(actor.grants, task.centreId, task.assignedStaffId, actor.staffUserId, task.taskType)) throw new Error("forbidden");
  }
}

