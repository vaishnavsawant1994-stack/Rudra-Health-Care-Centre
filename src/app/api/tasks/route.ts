import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { staffApprovalPolicies, staffRoleAssignments, staffTasks, staffTaskEvents, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canReadTask, staffTaskCreateSchema, taskQueueIsAssignedOnly } from "@/server/staff-task-policy";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { hasPermission } from "@/server/permissions";
import { canRequestTaskApproval } from "@/server/staff-approval-policy";
import { legacyTaskCreateFingerprint, sameTaskCreatePrivateData, taskCreateFingerprint } from "@/server/staff-task-idempotency";
import { resolveTaskReference, type TaskReference } from "@/server/task-reference";
import { z } from "zod";

const uuid = z.uuid();
const TASK_PAGE_SIZE = 100;
type PrivateTask = { title: string; description: string; reference?: (TaskReference & { label: string }) | null };
const taskContext = (organizationId: string, centreId: string, recordId: string) => operationalContext({ organizationId, centreId, recordId }, "staff-task");
const eventContext = (organizationId: string, centreId: string, recordId: string) => operationalContext({ organizationId, centreId, recordId }, "staff-task-event");

async function taskReadAccess(centreId?: string) {
  const broad = await getApiAccess("tasks.read", centreId);
  if (!broad.response) return { ...broad, assignedOnly: false, supportOnly: false, supportQueue: false } as const;
  const assigned = await getApiAccess("tasks.assigned.read", centreId);
  if (!assigned.response) {
    const supportQueue = hasPermission(assigned.staff.grants, "tasks.support.read", centreId);
    return { ...assigned, assignedOnly: taskQueueIsAssignedOnly(assigned.staff.grants, centreId), supportOnly: false, supportQueue } as const;
  }
  const support = await getApiAccess("tasks.support.read", centreId);
  if (!support.response) return { ...support, assignedOnly: false, supportOnly: true, supportQueue: true } as const;
  return { ...broad, assignedOnly: false, supportOnly: false, supportQueue: false } as const;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pageValue = params.get("page") ?? "1";
  if (!/^\d+$/.test(pageValue) || Number(pageValue) < 1 || Number(pageValue) > 100_000) return Response.json({ error: "invalid_page" }, { status: 400 });
  const page = Number(pageValue);
  const centreValue = params.get("centreId") ?? undefined;
  if (centreValue && !uuid.safeParse(centreValue).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const access = await taskReadAccess(centreValue);
  if (access.response) return access.response;
  const staff = access.staff;
  const permissions = staff.grants;
  const permittedCentres = permissions.filter((grant) => ["tasks.read", "tasks.assigned.read", "tasks.support.read"].includes(grant.key) && grant.centreId !== null).map((grant) => grant.centreId!);
  const broad = permissions.some((grant) => grant.key === "tasks.read" && grant.centreId === null);
  const anyUnscopedGrant = permissions.some((grant) => ["tasks.read", "tasks.assigned.read", "tasks.support.read"].includes(grant.key) && grant.centreId === null);
  const conditions = [eq(staffTasks.organizationId, staff.organizationId)];
  if (centreValue) conditions.push(eq(staffTasks.centreId, centreValue));
  else if (!broad && !anyUnscopedGrant) conditions.push(inArray(staffTasks.centreId, [...new Set(permittedCentres)]));
  if (access.assignedOnly) {
    const assignedCondition = or(eq(staffTasks.assignedStaffId, staff.staffUserId), and(eq(staffTasks.escalationOwnerStaffId, staff.staffUserId), eq(staffTasks.status, "AWAITING_APPROVAL"), eq(staffTasks.approvalStatus, "PENDING"), sql`${staffTasks.escalationProcessedAt} IS NOT NULL`))!;
    conditions.push(access.supportQueue ? or(assignedCondition, eq(staffTasks.taskType, "SUPPORT_REQUEST"))! : assignedCondition);
  }
  if (access.supportOnly) conditions.push(eq(staffTasks.taskType, "SUPPORT_REQUEST"));
  const filter = params.get("status");
  const typeFilter = params.get("type");
  if (filter && !["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "COMPLETED", "CANCELLED", "OVERDUE", "ESCALATED", "APPROVAL_EXPIRY_DUE", "APPROVAL_ESCALATION_DUE"].includes(filter)) return Response.json({ error: "invalid_task_status" }, { status: 400 });
  if (typeFilter && !["GENERAL", "OPERATIONS", "FOLLOW_UP", "EXCEPTION_REVIEW", "SUPPORT_REQUEST"].includes(typeFilter)) return Response.json({ error: "invalid_task_type" }, { status: 400 });
  if (typeFilter) conditions.push(eq(staffTasks.taskType, typeFilter));
  if (filter && ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "COMPLETED", "CANCELLED"].includes(filter)) conditions.push(eq(staffTasks.status, filter));
  if (filter === "OVERDUE") conditions.push(and(inArray(staffTasks.status, ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"]), lt(staffTasks.dueAt, new Date()))!);
  if (filter === "ESCALATED") conditions.push(or(
    and(eq(staffTasks.status, "AWAITING_APPROVAL"), lt(staffTasks.escalationDueAt, new Date()), isNull(staffTasks.escalationProcessedAt)),
    and(eq(staffTasks.taskType, "EXCEPTION_REVIEW"), inArray(staffTasks.status, ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"])),
  )!);
  if (filter === "APPROVAL_EXPIRY_DUE") conditions.push(and(eq(staffTasks.status, "AWAITING_APPROVAL"), eq(staffTasks.approvalStatus, "PENDING"), lt(staffTasks.approvalExpiresAt, new Date()))!);
  if (filter === "APPROVAL_ESCALATION_DUE") conditions.push(and(eq(staffTasks.status, "AWAITING_APPROVAL"), eq(staffTasks.approvalStatus, "PENDING"), lt(staffTasks.escalationDueAt, new Date()), isNull(staffTasks.escalationProcessedAt))!);
  const rows = await getDb().select({ id: staffTasks.id, organizationId: staffTasks.organizationId, centreId: staffTasks.centreId, taskNumber: staffTasks.taskNumber, privateDataCiphertext: staffTasks.privateDataCiphertext, taskType: staffTasks.taskType, priority: staffTasks.priority, status: staffTasks.status, approvalStatus: staffTasks.approvalStatus, approvalPolicyId: staffTasks.approvalPolicyId, approvalExpiresAt: staffTasks.approvalExpiresAt, escalationOwnerStaffId: staffTasks.escalationOwnerStaffId, escalationDueAt: staffTasks.escalationDueAt, escalationProcessedAt: staffTasks.escalationProcessedAt, assignedStaffId: staffTasks.assignedStaffId, assignedStaffName: staffUsers.displayName, createdByStaffId: staffTasks.createdByStaffId, dueAt: staffTasks.dueAt, versionNumber: staffTasks.versionNumber, requiresApproval: staffTasks.requiresApproval, createdAt: staffTasks.createdAt })
    .from(staffTasks).innerJoin(staffUsers, and(eq(staffUsers.id, staffTasks.assignedStaffId), eq(staffUsers.organizationId, staffTasks.organizationId)))
    .where(and(...conditions)).orderBy(
      filter === "APPROVAL_EXPIRY_DUE" ? sql`${staffTasks.approvalExpiresAt} ASC NULLS LAST`
        : filter === "APPROVAL_ESCALATION_DUE" ? sql`${staffTasks.escalationDueAt} ASC NULLS LAST`
          : sql`${staffTasks.dueAt} ASC NULLS LAST`,
      desc(staffTasks.createdAt), asc(staffTasks.id),
    ).limit(TASK_PAGE_SIZE + 1).offset((page - 1) * TASK_PAGE_SIZE);
  const hasMore = rows.length > TASK_PAGE_SIZE;
  const pageRows = rows.slice(0, TASK_PAGE_SIZE);
  const tasks = await Promise.all(pageRows.filter((row) => canReadTask(permissions, row.centreId, row.assignedStaffId, staff.staffUserId, { ownerStaffId: row.escalationOwnerStaffId, processedAt: row.escalationProcessedAt, pending: row.status === "AWAITING_APPROVAL" && row.approvalStatus === "PENDING" }, row.taskType)).map(async ({ privateDataCiphertext, organizationId, centreId, id, ...row }) => {
    const privateData = decryptOperationalData<PrivateTask>(privateDataCiphertext, taskContext(organizationId, centreId, id));
    if (privateData.reference && !await resolveTaskReference(staff, centreId, privateData.reference)) privateData.reference = null;
    return { id, ...row, ...privateData };
  }));
  return Response.json({ tasks, page, pageSize: TASK_PAGE_SIZE, hasMore });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const key = request.headers.get("idempotency-key");
  if (!uuid.safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = staffTaskCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_task", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("tasks.create", parsed.data.centreId);
  if (access.response) return access.response;
  const staff = access.staff;
  if (parsed.data.taskType === "SUPPORT_REQUEST" && !hasPermission(staff.grants, "tasks.support.create", parsed.data.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (parsed.data.assignedStaffId !== staff.staffUserId) {
    const assign = await getApiAccess("tasks.assign", parsed.data.centreId);
    if (assign.response) return assign.response;
  }
  const [assignee] = await getDb().select({ id: staffUsers.id }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt))).where(and(eq(staffUsers.id, parsed.data.assignedStaffId), eq(staffUsers.organizationId, staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, parsed.data.centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
  if (!assignee) return Response.json({ error: "assignee_not_found" }, { status: 400 });
  const requestHash = taskCreateFingerprint(parsed.data);
  const id = randomUUID();
  let reference: PrivateTask["reference"] = null;
  if (parsed.data.reference) {
    const source = await resolveTaskReference(staff, parsed.data.centreId, parsed.data.reference);
    if (!source) return Response.json({ error: "reference_not_found_or_forbidden" }, { status: 404 });
    reference = { ...parsed.data.reference, label: source };
  }
  const data: PrivateTask = { title: parsed.data.title, description: parsed.data.description, reference };
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${staff.organizationId}:task:${key}`}, 0))`);
      const prior = await tx.select({ id: staffTasks.id, taskNumber: staffTasks.taskNumber, requestHash: staffTasks.requestHash, privateDataCiphertext: staffTasks.privateDataCiphertext, centreId: staffTasks.centreId, assignedStaffId: staffTasks.assignedStaffId }).from(staffTasks).where(and(eq(staffTasks.organizationId, staff.organizationId), eq(staffTasks.idempotencyKey, key!))).limit(1);
      if (prior[0]) {
        const existingPrivate = decryptOperationalData<PrivateTask>(prior[0].privateDataCiphertext, taskContext(staff.organizationId, prior[0].centreId, prior[0].id));
        if ((prior[0].requestHash !== requestHash && prior[0].requestHash !== legacyTaskCreateFingerprint(parsed.data)) || !sameTaskCreatePrivateData(existingPrivate, parsed.data)) throw new Error("idempotency_conflict");
        const read = await taskReadAccess(prior[0].centreId);
        if (read.response || !canReadTask(read.staff.grants, prior[0].centreId, prior[0].assignedStaffId, read.staff.staffUserId, undefined, parsed.data.taskType)) throw new Error("forbidden");
        return { id: prior[0].id, taskNumber: prior[0].taskNumber, replayed: true };
      }
      let approvalPolicyId: string | null = null;
      if (parsed.data.requiresApproval) {
        const [policy] = await tx.select().from(staffApprovalPolicies).where(and(eq(staffApprovalPolicies.organizationId, staff.organizationId), eq(staffApprovalPolicies.actionType, "TASK_COMPLETION"), or(eq(staffApprovalPolicies.centreId, parsed.data.centreId), isNull(staffApprovalPolicies.centreId)))).orderBy(sql`CASE WHEN ${staffApprovalPolicies.centreId} = ${parsed.data.centreId} THEN 0 ELSE 1 END`).limit(1);
        if (!canRequestTaskApproval(policy)) throw new Error("approval_policy_unavailable");
        approvalPolicyId = policy.id;
      }
      const [created] = await tx.insert(staffTasks).values({ id, organizationId: staff.organizationId, centreId: parsed.data.centreId, taskNumber: `RHC-T-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`, privateDataCiphertext: encryptOperationalData(data, taskContext(staff.organizationId, parsed.data.centreId, id)), taskType: parsed.data.taskType, priority: parsed.data.priority, status: "OPEN", requiresApproval: parsed.data.requiresApproval, approvalStatus: "NOT_REQUIRED", approvalPolicyId, assignedStaffId: parsed.data.assignedStaffId, createdByStaffId: staff.staffUserId, dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, idempotencyKey: key!, requestHash }).returning({ id: staffTasks.id, taskNumber: staffTasks.taskNumber });
      const eventId = randomUUID();
      await tx.insert(staffTaskEvents).values({ id: eventId, organizationId: staff.organizationId, centreId: parsed.data.centreId, taskId: id, eventType: "CREATED", privateDataCiphertext: encryptOperationalData({ title: "Task created", description: "", assignedStaffId: parsed.data.assignedStaffId }, eventContext(staff.organizationId, parsed.data.centreId, eventId)), actorStaffId: staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: staff.organizationId, centreId: parsed.data.centreId, actorStaffId: staff.staffUserId, action: "staff_task.created", entityType: "staff_task", entityId: id, details: { taskType: parsed.data.taskType, priority: parsed.data.priority, requiresApproval: parsed.data.requiresApproval } });
      return { ...created, replayed: false };
    });
    return Response.json({ task: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
      return Response.json({ error: code === "idempotency_conflict" || code === "approval_policy_unavailable" ? code : "task_creation_failed" }, { status: code === "idempotency_conflict" ? 409 : code === "approval_policy_unavailable" ? 409 : 500 });
  }
}

