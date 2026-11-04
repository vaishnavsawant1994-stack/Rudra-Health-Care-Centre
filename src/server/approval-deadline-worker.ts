import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, not, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { permissions, rolePermissions, roles, staffRoleAssignments, staffTaskEvents, staffTasks, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const contextForEvent = (organizationId: string, centreId: string, eventId: string) =>
  operationalContext({ organizationId, centreId, recordId: eventId }, "staff-task-event");

/** Processes a bounded set of due approvals. System actions have an explicit SYSTEM actor. */
export async function processDueTaskApprovalDeadlines(limit = 50, now = new Date(), scope?: { organizationId: string; centreIds: string[] | null; triggeredByStaffId?: string }) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return getDb().transaction(async (tx) => {
    const scopeConditions = [
      scope ? eq(staffTasks.organizationId, scope.organizationId) : undefined,
      scope?.centreIds ? scope.centreIds.length ? inArray(staffTasks.centreId, scope.centreIds) : sql`false` : undefined,
    ];
    // Keep stale or conflicting escalation assignments out of the bounded work
    // batch. They remain pending for manager repair, but cannot starve eligible
    // expirations/escalations that sort behind them.
    const eligibleEscalationOwner = sql`EXISTS (
      SELECT 1 FROM staff_users owner_user
      JOIN staff_role_assignments owner_assignment
        ON owner_assignment.staff_user_id = owner_user.id
       AND owner_assignment.organization_id = owner_user.organization_id
       AND owner_assignment.revoked_at IS NULL
      JOIN roles owner_role ON owner_role.id = owner_assignment.role_id
      JOIN role_permissions owner_role_permission ON owner_role_permission.role_id = owner_role.id
      JOIN permissions owner_permission
        ON owner_permission.id = owner_role_permission.permission_id
       AND owner_permission.key = 'tasks.approve'
      AND EXISTS (
        SELECT 1 FROM staff_role_assignments owner_read_assignment
        JOIN roles owner_read_role ON owner_read_role.id = owner_read_assignment.role_id
        JOIN role_permissions owner_read_role_permission ON owner_read_role_permission.role_id = owner_read_role.id
        JOIN permissions owner_read_permission ON owner_read_permission.id = owner_read_role_permission.permission_id
        WHERE owner_read_assignment.staff_user_id = owner_user.id
          AND owner_read_assignment.organization_id = owner_user.organization_id
          AND owner_read_assignment.revoked_at IS NULL
          AND (owner_read_assignment.centre_id = staff_tasks.centre_id OR owner_read_assignment.centre_id IS NULL)
          AND owner_read_permission.key = 'tasks.read'
      )
      WHERE owner_user.id = staff_tasks.escalation_owner_staff_id
        AND owner_user.organization_id = staff_tasks.organization_id
        AND owner_user.status = 'ACTIVE'
        AND (owner_assignment.centre_id = staff_tasks.centre_id OR owner_assignment.centre_id IS NULL)
        AND owner_user.id <> staff_tasks.assigned_staff_id
        AND owner_user.id <> staff_tasks.created_by_staff_id
    )`;
    const escalationDue = and(
      eq(staffTasks.status, "AWAITING_APPROVAL"), eq(staffTasks.approvalStatus, "PENDING"),
      sql`${staffTasks.escalationDueAt} IS NOT NULL`, sql`${staffTasks.escalationDueAt} <= ${now}`, isNull(staffTasks.escalationProcessedAt),
    );
    const invalidOwnerDue = and(
      ...scopeConditions, escalationDue,
      sql`(${staffTasks.approvalExpiresAt} IS NULL OR ${staffTasks.approvalExpiresAt} > ${now})`,
      not(eligibleEscalationOwner),
    );
    const invalidOwnerRows = await tx.select({ count: sql<number>`count(*)::int` }).from(staffTasks).where(invalidOwnerDue);
    let skippedInvalidOwner = invalidOwnerRows[0]?.count ?? 0;
    const due = await tx.select().from(staffTasks).where(and(
      ...scopeConditions,
      eq(staffTasks.status, "AWAITING_APPROVAL"), eq(staffTasks.approvalStatus, "PENDING"),
      or(and(sql`${staffTasks.approvalExpiresAt} IS NOT NULL`, sql`${staffTasks.approvalExpiresAt} <= ${now}`),
        and(escalationDue, eligibleEscalationOwner)),
    )).orderBy(asc(staffTasks.approvalExpiresAt), asc(staffTasks.escalationDueAt), asc(staffTasks.id)).limit(boundedLimit).for("update", { skipLocked: true });

    let expired = 0;
    let escalated = 0;
    for (const task of due) {
      // Expiry takes precedence if both deadlines have elapsed.
      if (task.approvalExpiresAt && task.approvalExpiresAt <= now) {
        const [updated] = await tx.update(staffTasks).set({ status: "IN_PROGRESS", approvalStatus: "EXPIRED", approvalExpiresAt: null, escalationOwnerStaffId: null, escalationDueAt: null, versionNumber: task.versionNumber + 1, updatedAt: now }).where(and(eq(staffTasks.id, task.id), eq(staffTasks.versionNumber, task.versionNumber))).returning({ versionNumber: staffTasks.versionNumber });
        if (!updated) continue;
        const eventId = randomUUID();
        await tx.insert(staffTaskEvents).values({ id: eventId, organizationId: task.organizationId, centreId: task.centreId, taskId: task.id, eventType: "APPROVAL_EXPIRED", actorType: "SYSTEM", actorStaffId: null, privateDataCiphertext: encryptOperationalData({ reason: "Approval deadline elapsed; system expiry processor" }, contextForEvent(task.organizationId, task.centreId, eventId)) });
        await appendAuditEvent(tx, { organizationId: task.organizationId, centreId: task.centreId, actorStaffId: scope?.triggeredByStaffId ?? null, action: "staff_task.approval_expired", entityType: "staff_task", entityId: task.id, details: { version: updated.versionNumber, actorType: "SYSTEM", initiatedByStaff: Boolean(scope?.triggeredByStaffId) } });
        expired++;
        continue;
      }
      if (!task.escalationDueAt || task.escalationDueAt > now || task.escalationProcessedAt || !task.escalationOwnerStaffId) continue;
      if (task.escalationOwnerStaffId === task.assignedStaffId || task.escalationOwnerStaffId === task.createdByStaffId) { skippedInvalidOwner++; continue; }
      const [eligible] = await tx.select({ id: staffUsers.id }).from(staffUsers)
        .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
        .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "tasks.approve")))
        .where(and(eq(staffUsers.id, task.escalationOwnerStaffId), eq(staffUsers.organizationId, task.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, task.centreId), isNull(staffRoleAssignments.centreId)), sql`EXISTS (
          SELECT 1 FROM staff_role_assignments read_assignment
          JOIN roles read_role ON read_role.id = read_assignment.role_id
          JOIN role_permissions read_role_permission ON read_role_permission.role_id = read_role.id
          JOIN permissions read_permission ON read_permission.id = read_role_permission.permission_id
          WHERE read_assignment.staff_user_id = ${staffUsers.id}
            AND read_assignment.organization_id = ${staffUsers.organizationId}
            AND read_assignment.revoked_at IS NULL
            AND (read_assignment.centre_id = ${task.centreId} OR read_assignment.centre_id IS NULL)
            AND read_permission.key = 'tasks.read'
        )`)).limit(1);
      if (!eligible) { skippedInvalidOwner++; continue; }
      const [updated] = await tx.update(staffTasks).set({ escalationProcessedAt: now, versionNumber: task.versionNumber + 1, updatedAt: now }).where(and(eq(staffTasks.id, task.id), eq(staffTasks.versionNumber, task.versionNumber), isNull(staffTasks.escalationProcessedAt))).returning({ versionNumber: staffTasks.versionNumber });
      if (!updated) continue;
      const eventId = randomUUID();
      await tx.insert(staffTaskEvents).values({ id: eventId, organizationId: task.organizationId, centreId: task.centreId, taskId: task.id, eventType: "ESCALATED", actorType: "SYSTEM", actorStaffId: null, privateDataCiphertext: encryptOperationalData({ escalationOwnerStaffId: task.escalationOwnerStaffId, escalationDueAt: task.escalationDueAt.toISOString(), reason: "Approval deadline elapsed; system escalation processor" }, contextForEvent(task.organizationId, task.centreId, eventId)) });
      await appendAuditEvent(tx, { organizationId: task.organizationId, centreId: task.centreId, actorStaffId: scope?.triggeredByStaffId ?? null, action: "staff_task.escalated", entityType: "staff_task", entityId: task.id, details: { version: updated.versionNumber, actorType: "SYSTEM", initiatedByStaff: Boolean(scope?.triggeredByStaffId) } });
      escalated++;
    }
    return { processed: expired + escalated, expired, escalated, skippedInvalidOwner, limit: boundedLimit };
  });
}
