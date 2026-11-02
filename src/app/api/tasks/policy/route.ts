import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { auditEvents, centres, permissions, rolePermissions, roles, staffApprovalPolicies, staffApprovalPolicyApprovers, staffRoleAssignments, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { approvalPolicyCentreScope, approvalPolicyScopeAllowed, buildApprovalPolicyDirectory } from "@/server/staff-approval-policy";

const uuid = z.uuid();
const policyIdempotencyKeySchema = z.uuid();
const policyInput = z.object({
  centreId: z.uuid().nullable(), actionType: z.literal("TASK_COMPLETION"), enabled: z.boolean(),
  approverStaffIds: z.array(z.uuid()).max(50).default([]), escalationAfterMinutes: z.number().int().min(15).max(10080).nullable(), expireAfterMinutes: z.number().int().min(15).max(10080).nullable().default(null),
  escalationOwnerStaffId: z.uuid().nullable(), expectedVersion: z.number().int().min(0),
}).superRefine((value, ctx) => {
  if (new Set(value.approverStaffIds).size !== value.approverStaffIds.length) ctx.addIssue({ code: "custom", path: ["approverStaffIds"], message: "Approver selections must be unique." });
  if ((value.escalationAfterMinutes === null) !== (value.escalationOwnerStaffId === null)) ctx.addIssue({ code: "custom", path: ["escalationOwnerStaffId"], message: "Escalation time and owner must be configured together." });
  if (value.escalationOwnerStaffId && value.approverStaffIds.length && !value.approverStaffIds.includes(value.escalationOwnerStaffId)) ctx.addIssue({ code: "custom", path: ["escalationOwnerStaffId"], message: "Escalation owner must be in the selected approver list." });
});

async function eligibleApprovers(organizationId: string, centreId: string | null) {
  const rows = await getDb().selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode })
    .from(staffUsers)
    .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
    .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "tasks.approve")))
    .where(and(eq(staffUsers.organizationId, organizationId), eq(staffUsers.status, "ACTIVE"), centreId ? or(eq(staffRoleAssignments.centreId, centreId), isNull(staffRoleAssignments.centreId)) : isNull(staffRoleAssignments.centreId)));
  return rows;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  if (view && view !== "directory" && view !== "history") return Response.json({ error: "invalid_view" }, { status: 400 });
  const rawBefore = params.get("before");
  if (rawBefore && (view !== "history" || !/^[1-9]\d{0,18}$/.test(rawBefore) || BigInt(rawBefore) > BigInt("9223372036854775807"))) return Response.json({ error: "invalid_cursor" }, { status: 400 });
  const rawCentre = params.get("centreId");
  if (rawCentre && !uuid.safeParse(rawCentre).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const centreId = rawCentre || null;
  if (view === "directory" && centreId) return Response.json({ error: "invalid_scope" }, { status: 400 });
  const access = await getApiAccess("tasks.policy.manage", centreId ?? undefined);
  if (access.response) return access.response;
  if (view === "directory") {
    const scope = approvalPolicyCentreScope(access.staff.grants);
    const db = getDb();
    const permittedCentres = scope?.length === 0 ? [] : await db.select({ id: centres.id, code: centres.code, name: centres.name })
      .from(centres)
      .where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), scope ? inArray(centres.id, scope) : undefined))
      .orderBy(asc(centres.name));
    const policies = await db.select({ id: staffApprovalPolicies.id, centreId: staffApprovalPolicies.centreId, enabled: staffApprovalPolicies.enabled, versionNumber: staffApprovalPolicies.versionNumber, escalationAfterMinutes: staffApprovalPolicies.escalationAfterMinutes, expireAfterMinutes: staffApprovalPolicies.expireAfterMinutes, updatedAt: staffApprovalPolicies.updatedAt })
      .from(staffApprovalPolicies)
      .where(and(eq(staffApprovalPolicies.organizationId, access.staff.organizationId), eq(staffApprovalPolicies.actionType, "TASK_COMPLETION"), scope?.length === 0 ? sql`false` : scope ? or(isNull(staffApprovalPolicies.centreId), inArray(staffApprovalPolicies.centreId, scope)) : undefined));
    return Response.json({ policies: buildApprovalPolicyDirectory(access.staff.grants, permittedCentres, policies) });
  }
  if (!approvalPolicyScopeAllowed(access.staff.grants, centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (centreId) {
    const [centre] = await getDb().select({ id: centres.id }).from(centres).where(and(eq(centres.id, centreId), eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
    if (!centre) return Response.json({ error: "not_found" }, { status: 404 });
  }
  const policyRows = await getDb().select().from(staffApprovalPolicies)
    .where(and(eq(staffApprovalPolicies.organizationId, access.staff.organizationId), eq(staffApprovalPolicies.actionType, "TASK_COMPLETION"), centreId ? or(eq(staffApprovalPolicies.centreId, centreId), isNull(staffApprovalPolicies.centreId)) : isNull(staffApprovalPolicies.centreId)))
    .limit(2);
  const policy = policyRows.find((row) => row.centreId === centreId) ?? (centreId ? undefined : policyRows[0]);
  const inheritedPolicy = centreId ? policyRows.find((row) => row.centreId === null) : undefined;
  if (view === "history") {
    if (!policy) return Response.json({ history: [] });
    const rows = await getDb().select({ sequence: sql<string>`${auditEvents.sequence}::text`, action: auditEvents.action, details: auditEvents.details, actorStaffId: auditEvents.actorStaffId, recordedAt: auditEvents.recordedAt })
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, access.staff.organizationId), centreId ? eq(auditEvents.centreId, centreId) : isNull(auditEvents.centreId), eq(auditEvents.entityType, "staff_approval_policy"), eq(auditEvents.entityId, policy.id), eq(auditEvents.action, "staff_approval_policy.updated"), rawBefore ? sql`${auditEvents.sequence} < ${rawBefore}::bigint` : undefined))
      .orderBy(desc(auditEvents.sequence)).limit(50);
    const referencedStaffIds = new Set<string>();
    for (const row of rows) {
      if (row.actorStaffId) referencedStaffIds.add(row.actorStaffId);
      const details = row.details as Record<string, unknown>;
      if (Array.isArray(details.approverStaffIds)) for (const id of details.approverStaffIds) if (typeof id === "string") referencedStaffIds.add(id);
      if (typeof details.escalationOwnerStaffId === "string") referencedStaffIds.add(details.escalationOwnerStaffId);
    }
    const staffRows = referencedStaffIds.size
      ? await getDb().select({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode }).from(staffUsers)
        .where(and(eq(staffUsers.organizationId, access.staff.organizationId), inArray(staffUsers.id, [...referencedStaffIds])))
      : [];
    const staffLabels = new Map(staffRows.map((staff) => [staff.id, `${staff.displayName} (${staff.staffCode})`]));
    const history = rows.map((row) => {
      const details = row.details as Record<string, unknown>;
      return {
        action: row.action,
        sequence: row.sequence,
        actorDisplayName: row.actorStaffId ? staffLabels.get(row.actorStaffId) ?? "Unavailable staff record" : "System",
        recordedAt: row.recordedAt,
        snapshotComplete: Array.isArray(details.approverStaffIds) && Object.hasOwn(details, "escalationAfterMinutes") && Object.hasOwn(details, "escalationOwnerStaffId") && Object.hasOwn(details, "expireAfterMinutes"),
        version: typeof details.version === "number" ? details.version : null,
        enabled: typeof details.enabled === "boolean" ? details.enabled : null,
        approverDisplayNames: Array.isArray(details.approverStaffIds) && details.approverStaffIds.every((id) => typeof id === "string") ? details.approverStaffIds.map((id) => staffLabels.get(id) ?? "Unavailable staff record") : null,
        escalationAfterMinutes: typeof details.escalationAfterMinutes === "number" ? details.escalationAfterMinutes : null,
        escalationOwnerDisplayName: typeof details.escalationOwnerStaffId === "string" ? staffLabels.get(details.escalationOwnerStaffId) ?? "Unavailable staff record" : null,
        expireAfterMinutes: typeof details.expireAfterMinutes === "number" ? details.expireAfterMinutes : null,
      };
    });
    return Response.json({ history, hasMore: rows.length === 50, nextBefore: rows.length === 50 ? rows[rows.length - 1].sequence : null });
  }
  const approvers = policy ? await getDb().select({ staffId: staffApprovalPolicyApprovers.staffId }).from(staffApprovalPolicyApprovers).where(and(eq(staffApprovalPolicyApprovers.organizationId, access.staff.organizationId), eq(staffApprovalPolicyApprovers.policyId, policy.id))) : [];
  return Response.json({ policy: policy ? { id: policy.id, centreId: policy.centreId, actionType: policy.actionType, enabled: policy.enabled, approverPermission: policy.approverPermission, approverStaffIds: approvers.map((item) => item.staffId), escalationAfterMinutes: policy.escalationAfterMinutes, escalationOwnerStaffId: policy.escalationOwnerStaffId, expireAfterMinutes: policy.expireAfterMinutes, versionNumber: policy.versionNumber } : null,
    effectivePolicy: centreId ? { source: policy ? "CENTRE" : inheritedPolicy ? "ORGANIZATION" : "NONE", enabled: (policy ?? inheritedPolicy)?.enabled ?? false } : undefined,
    eligibleApprovers: await eligibleApprovers(access.staff.organizationId, centreId) });
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = policyInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_approval_policy", fields: parsed.error.issues.map((item) => item.path.join(".")) }, { status: 400 });
  const input = parsed.data;
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!policyIdempotencyKeySchema.safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const access = await getApiAccess("tasks.policy.manage", input.centreId ?? undefined);
  if (access.response) return access.response;
  const orgId = access.staff.organizationId;
  if (!approvalPolicyScopeAllowed(access.staff.grants, input.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  const db = getDb();
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const replayPolicy = async (queryable: typeof db) => {
    const [event] = await queryable.select({ entityId: auditEvents.entityId, details: auditEvents.details }).from(auditEvents)
      .where(and(eq(auditEvents.organizationId, orgId), eq(auditEvents.entityType, "staff_approval_policy"), eq(auditEvents.action, "staff_approval_policy.updated"), sql`${auditEvents.details}->>'idempotencyKey' = ${idempotencyKey!}`))
      .orderBy(desc(auditEvents.sequence)).limit(1);
    if (!event) return null;
    const details = event.details as Record<string, unknown>;
    if (details.requestHash !== requestHash) throw new Error("idempotency_conflict");
    if (typeof details.enabled !== "boolean" || !Array.isArray(details.approverStaffIds) || !details.approverStaffIds.every((id) => typeof id === "string") || typeof details.version !== "number") throw new Error("idempotency_result_unavailable");
    return { id: event.entityId, centreId: input.centreId, actionType: input.actionType, enabled: details.enabled, approverPermission: "tasks.approve", approverStaffIds: details.approverStaffIds as string[], escalationAfterMinutes: typeof details.escalationAfterMinutes === "number" ? details.escalationAfterMinutes : null, escalationOwnerStaffId: typeof details.escalationOwnerStaffId === "string" ? details.escalationOwnerStaffId : null, expireAfterMinutes: typeof details.expireAfterMinutes === "number" ? details.expireAfterMinutes : null, versionNumber: details.version, replayed: true };
  };
  if (input.centreId) {
    const [centre] = await db.select({ id: centres.id }).from(centres).where(and(eq(centres.id, input.centreId), eq(centres.organizationId, orgId), eq(centres.status, "ACTIVE"))).limit(1);
    if (!centre) return Response.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const prior = await replayPolicy(db);
    if (prior) return Response.json({ policy: prior });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return Response.json({ error: reason === "idempotency_conflict" ? reason : "approval_policy_replay_unavailable" }, { status: reason === "idempotency_conflict" ? 409 : 500 });
  }
  const eligible = await eligibleApprovers(orgId, input.centreId);
  const eligibleIds = new Set(eligible.map((row) => row.id));
  if (input.approverStaffIds.some((id) => !eligibleIds.has(id)) || (input.escalationOwnerStaffId && !eligibleIds.has(input.escalationOwnerStaffId))) return Response.json({ error: "approver_not_eligible" }, { status: 400 });
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${orgId}:approval-policy-idempotency:${idempotencyKey}`}, 0))`);
      const previous = await replayPolicy(tx as typeof db);
      if (previous) return previous;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${orgId}:approval-policy:${input.centreId ?? "organization"}:TASK_COMPLETION`}, 0))`);
      const [existing] = await tx.select().from(staffApprovalPolicies).where(and(eq(staffApprovalPolicies.organizationId, orgId), eq(staffApprovalPolicies.actionType, input.actionType), input.centreId ? eq(staffApprovalPolicies.centreId, input.centreId) : isNull(staffApprovalPolicies.centreId))).for("update").limit(1);
      if ((existing?.versionNumber ?? 0) !== input.expectedVersion) throw new Error("version_conflict");
      // Recheck and lock the current authorization rows inside the policy
      // transaction. The earlier query gives fast feedback, but cannot be the
      // authority if a role or centre assignment changes before this commit.
      const eligibleAtCommitRows = await tx.select({ id: staffUsers.id })
        .from(staffUsers)
        .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
        .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, "tasks.approve")))
        .where(and(eq(staffUsers.organizationId, orgId), eq(staffUsers.status, "ACTIVE"), input.centreId ? or(eq(staffRoleAssignments.centreId, input.centreId), isNull(staffRoleAssignments.centreId)) : isNull(staffRoleAssignments.centreId)))
        .for("share");
      const eligibleAtCommit = new Set(eligibleAtCommitRows.map((row) => row.id));
      if (input.approverStaffIds.some((staffId) => !eligibleAtCommit.has(staffId)) || (input.escalationOwnerStaffId && !eligibleAtCommit.has(input.escalationOwnerStaffId))) throw new Error("approver_not_eligible");
      if (input.enabled && !input.approverStaffIds.length && eligibleAtCommit.size === 0) throw new Error("approver_required");
      const policyId = existing?.id ?? crypto.randomUUID();
      const values = { enabled: input.enabled, approverPermission: "tasks.approve", escalationAfterMinutes: input.escalationAfterMinutes, escalationOwnerStaffId: input.escalationOwnerStaffId, expireAfterMinutes: input.expireAfterMinutes, versionNumber: input.expectedVersion + 1, updatedByStaffId: access.staff.staffUserId, updatedAt: new Date() };
      if (existing) await tx.update(staffApprovalPolicies).set(values).where(and(eq(staffApprovalPolicies.id, existing.id), eq(staffApprovalPolicies.versionNumber, input.expectedVersion)));
      else await tx.insert(staffApprovalPolicies).values({ ...values, id: policyId, organizationId: orgId, centreId: input.centreId, actionType: input.actionType, createdByStaffId: access.staff.staffUserId });
      await tx.delete(staffApprovalPolicyApprovers).where(and(eq(staffApprovalPolicyApprovers.organizationId, orgId), eq(staffApprovalPolicyApprovers.policyId, policyId)));
      if (input.approverStaffIds.length) await tx.insert(staffApprovalPolicyApprovers).values(input.approverStaffIds.map((staffId) => ({ organizationId: orgId, policyId, staffId, createdByStaffId: access.staff.staffUserId })));
      await appendAuditEvent(tx, { organizationId: orgId, centreId: input.centreId, actorStaffId: access.staff.staffUserId, action: "staff_approval_policy.updated", entityType: "staff_approval_policy", entityId: policyId, details: { actionType: input.actionType, enabled: input.enabled, approverCount: input.approverStaffIds.length, approverStaffIds: input.approverStaffIds, escalationAfterMinutes: input.escalationAfterMinutes, escalationOwnerStaffId: input.escalationOwnerStaffId, expireAfterMinutes: input.expireAfterMinutes, version: input.expectedVersion + 1, idempotencyKey, requestHash } });
      return { id: policyId, centreId: input.centreId, actionType: input.actionType, enabled: input.enabled, approverPermission: "tasks.approve", approverStaffIds: input.approverStaffIds, escalationAfterMinutes: input.escalationAfterMinutes, escalationOwnerStaffId: input.escalationOwnerStaffId, expireAfterMinutes: input.expireAfterMinutes, versionNumber: input.expectedVersion + 1, replayed: false };
    });
    return Response.json({ policy: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "version_conflict" || message === "idempotency_conflict" || message === "approver_not_eligible") return Response.json({ error: message }, { status: 409 });
    if (message === "approver_required") return Response.json({ error: message }, { status: 400 });
    if (message === "idempotency_result_unavailable") return Response.json({ error: "approval_policy_replay_unavailable" }, { status: 500 });
    return Response.json({ error: "approval_policy_update_failed" }, { status: 409 });
  }
}
