import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { permissions, rolePermissions, roles, staffEscalations, staffEscalationEvents, staffRoleAssignments, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { resolveTaskReference, type TaskReference } from "@/server/task-reference";
import { canManageEscalation, escalationActionAllowed } from "@/server/staff-escalation-policy";
import { escalationActionFingerprint, legacyEscalationActionFingerprint, sameEscalationPrivateAction } from "@/server/escalation-request-fingerprint";

const uuid = z.uuid();
const HISTORY_PAGE_SIZE = 100;
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACKNOWLEDGE"), expectedVersion: z.number().int().positive() }),
  z.object({ action: z.literal("COMMENT"), expectedVersion: z.number().int().positive(), comment: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("UPDATE"), expectedVersion: z.number().int().positive(), severity: z.enum(["LOW", "MODERATE", "HIGH", "URGENT"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), dueAt: z.iso.datetime().optional(), reason: z.string().trim().min(3).max(500) }).refine((value) => value.severity !== undefined || value.priority !== undefined || value.dueAt !== undefined, { message: "At least one escalation field must change." }),
  z.object({ action: z.literal("REASSIGN"), expectedVersion: z.number().int().positive(), assignedOwnerStaffId: uuid, reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("RESOLVE"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("REOPEN"), expectedVersion: z.number().int().positive(), dueAt: z.iso.datetime(), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("CANCEL"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }),
]);
type PrivateData = { title: string; description: string; reason?: string };
const ctx = (org: string, centre: string, id: string) => operationalContext({ organizationId: org, centreId: centre, recordId: id }, "staff-escalation");
const eventCtx = (org: string, centre: string, id: string) => operationalContext({ organizationId: org, centreId: centre, recordId: id }, "staff-escalation-event");

async function readAccess(centreId?: string) {
  const broad = await getApiAccess("escalations.read", centreId);
  if (!broad.response) return { ...broad, assignedOnly: false } as const;
  const assigned = await getApiAccess("escalations.assigned.read", centreId);
  return assigned.response ? { ...broad, assignedOnly: true } as const : { ...assigned, assignedOnly: true } as const;
}

export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const historyPageValue = new URL(request.url).searchParams.get("historyPage") ?? "1";
  if (!/^\d+$/.test(historyPageValue) || Number(historyPageValue) < 1 || Number(historyPageValue) > 100_000) return Response.json({ error: "invalid_history_page" }, { status: 400 });
  const historyPage = Number(historyPageValue);
  // Assigned-only escalation readers can reach a record from their queue without
  // needing the broader workspace permission. The centre-scoped check below
  // still decides whether this particular record is visible.
  const identity = await readAccess();
  if (identity.response) return identity.response;
  const [row] = await getDb().select().from(staffEscalations).where(and(eq(staffEscalations.id, id), eq(staffEscalations.organizationId, identity.staff.organizationId))).limit(1);
  if (!row) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await readAccess(row.centreId);
  if (access.response || (access.assignedOnly && row.assignedOwnerStaffId !== access.staff.staffUserId)) return Response.json({ error: "not_found" }, { status: 404 });
  const sourceLabel = await resolveTaskReference(access.staff, row.centreId, { type: row.sourceType as TaskReference["type"], id: row.sourceId });
  if (!sourceLabel) return Response.json({ error: "not_found" }, { status: 404 });
  const [owner] = await getDb().select({ displayName: staffUsers.displayName }).from(staffUsers).where(and(eq(staffUsers.id, row.assignedOwnerStaffId), eq(staffUsers.organizationId, row.organizationId))).limit(1);
  const pageEvents = await getDb().select({ id: staffEscalationEvents.id, eventType: staffEscalationEvents.eventType, privateDataCiphertext: staffEscalationEvents.privateDataCiphertext, actorStaffId: staffEscalationEvents.actorStaffId, actorName: staffUsers.displayName, recordedAt: staffEscalationEvents.recordedAt }).from(staffEscalationEvents).innerJoin(staffUsers, and(eq(staffUsers.id, staffEscalationEvents.actorStaffId), eq(staffUsers.organizationId, staffEscalationEvents.organizationId))).where(and(eq(staffEscalationEvents.organizationId, row.organizationId), eq(staffEscalationEvents.centreId, row.centreId), eq(staffEscalationEvents.escalationId, id))).orderBy(sql`${staffEscalationEvents.recordedAt} DESC`, sql`${staffEscalationEvents.id} DESC`).limit(HISTORY_PAGE_SIZE + 1).offset((historyPage - 1) * HISTORY_PAGE_SIZE);
  const historyHasMore = pageEvents.length > HISTORY_PAGE_SIZE;
  const events = pageEvents.slice(0, HISTORY_PAGE_SIZE).reverse();
  const privateData = decryptOperationalData<PrivateData>(row.privateDataCiphertext, ctx(row.organizationId, row.centreId, row.id));
  const historyRows = events.map(({ id: eventId, eventType, actorName, recordedAt, privateDataCiphertext: cipher }) => ({
    event: { id: eventId, eventType, actorName, recordedAt },
    data: decryptOperationalData<Record<string, unknown>>(cipher, eventCtx(row.organizationId, row.centreId, eventId)),
  }));
  const assignedOwnerIds = [...new Set(historyRows.map(({ data }) => data.assignedOwnerStaffId).filter((value): value is string => typeof value === "string"))];
  const assignedOwners = assignedOwnerIds.length ? await getDb().select({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode }).from(staffUsers).where(and(eq(staffUsers.organizationId, row.organizationId), inArray(staffUsers.id, assignedOwnerIds))) : [];
  const assignedOwnerLabels = new Map(assignedOwners.map((person) => [person.id, `${person.displayName} (${person.staffCode})`]));
  const mayManage = canManageEscalation(access.staff.grants, row.centreId);
  const history = historyRows.map(({ event, data }) => ({
    id: event.id,
    eventType: event.eventType,
    actorName: event.actorName,
    recordedAt: event.recordedAt,
    ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
    ...(typeof data.comment === "string" ? { comment: data.comment } : {}),
    ...(typeof data.assignedOwnerStaffId === "string" ? { assignedOwnerName: assignedOwnerLabels.get(data.assignedOwnerStaffId) ?? "Former or unavailable staff member" } : {}),
    ...(typeof data.sourceLabel === "string" ? { sourceLabel: data.sourceLabel } : {}),
    ...(typeof data.severity === "string" ? { severity: data.severity } : {}),
    ...(typeof data.priority === "string" ? { priority: data.priority } : {}),
    ...(typeof data.dueAt === "string" ? { dueAt: data.dueAt } : {}),
  }));
  return Response.json({ escalation: {
    id: row.id, centreId: row.centreId, escalationNumber: row.escalationNumber,
    severity: row.severity, priority: row.priority, status: row.status,
    ...(mayManage ? { assignedOwnerStaffId: row.assignedOwnerStaffId } : {}),
    dueAt: row.dueAt,
    resolvedAt: row.resolvedAt, versionNumber: row.versionNumber,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...privateData, ownerName: owner?.displayName ?? "Assigned staff",
    canManage: mayManage,
    source: { type: row.sourceType, id: row.sourceId, label: sourceLabel },
  }, history, historyPage, historyPageSize: HISTORY_PAGE_SIZE, historyHasMore });
}

export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await route.params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_escalation_action", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!uuid.safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const requestHash = escalationActionFingerprint(id, parsed.data);
  const legacyRequestHash = legacyEscalationActionFingerprint(id, parsed.data);
  // Keep the initial identity gate aligned with the queue's broad-or-assigned
  // access model; mutation-specific permissions are checked after loading the
  // centre-scoped record below.
  const identity = await readAccess();
  if (identity.response) return identity.response;
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${identity.staff.organizationId}:escalation-action-key:${idempotencyKey}`}, 0))`);
      const [row] = await tx.select().from(staffEscalations).where(and(eq(staffEscalations.id, id), eq(staffEscalations.organizationId, identity.staff.organizationId))).for("update").limit(1);
      if (!row) throw new Error("not_found");
      const access = await readAccess(row.centreId);
      if (access.response) throw new Error("not_found");
      const actor = access.staff;
      if (access.assignedOnly && row.assignedOwnerStaffId !== actor.staffUserId) throw new Error("not_found");
      const action = parsed.data.action;
      const manage = ["REASSIGN", "REOPEN", "CANCEL", "UPDATE"].includes(action);
      if (manage) {
        const permission = await getApiAccess("escalations.manage", row.centreId);
        if (permission.response) throw new Error("forbidden");
      } else if (row.assignedOwnerStaffId !== actor.staffUserId && !actor.grants.some((g) => g.key === "escalations.manage" && (g.centreId === null || g.centreId === row.centreId))) throw new Error("forbidden");
      const canManage = canManageEscalation(actor.grants, row.centreId);
      const [priorEvent] = await tx.select({ escalationId: staffEscalationEvents.escalationId, centreId: staffEscalationEvents.centreId, requestHash: staffEscalationEvents.requestHash, privateDataCiphertext: staffEscalationEvents.privateDataCiphertext, eventId: staffEscalationEvents.id }).from(staffEscalationEvents).where(and(eq(staffEscalationEvents.organizationId, row.organizationId), eq(staffEscalationEvents.idempotencyKey, idempotencyKey!))).limit(1);
      if (priorEvent) {
        if (priorEvent.escalationId !== row.id || (priorEvent.requestHash !== requestHash && priorEvent.requestHash !== legacyRequestHash)) throw new Error("idempotency_conflict");
        const priorData = decryptOperationalData<{ result?: { status: string; versionNumber: number }; reason?: string | null; comment?: string | null }>(priorEvent.privateDataCiphertext, eventCtx(row.organizationId, priorEvent.centreId, priorEvent.eventId));
        if (!sameEscalationPrivateAction(priorData, parsed.data)) throw new Error("idempotency_conflict");
        if (!priorData.result) throw new Error("idempotency_result_unavailable");
        return { id: row.id, ...priorData.result, replayed: true };
      }
      if (row.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
      if (!escalationActionAllowed({ action, status: row.status as "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED", assignedOwnerStaffId: row.assignedOwnerStaffId, actorStaffId: actor.staffUserId, canManage })) throw new Error("invalid_transition");
      const nextOwner = action === "REASSIGN" ? parsed.data.assignedOwnerStaffId : row.assignedOwnerStaffId;
      if (action === "UPDATE" && !["OPEN", "ACKNOWLEDGED"].includes(row.status)) throw new Error("invalid_transition");
      if (action === "UPDATE" && parsed.data.dueAt !== undefined && new Date(parsed.data.dueAt).getTime() !== row.dueAt.getTime() && Date.parse(parsed.data.dueAt) <= Date.now()) throw new Error("due_date_must_be_future");
      if (action === "REOPEN" && Date.parse(parsed.data.dueAt) <= Date.now()) throw new Error("due_date_must_be_future");
      if (action === "REASSIGN") {
        const [assignee] = await tx.select({ id: staffUsers.id }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt))).innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), inArray(permissions.key, ["escalations.read", "escalations.assigned.read"]))).where(and(eq(staffUsers.id, nextOwner), eq(staffUsers.organizationId, row.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, row.centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
        if (!assignee) throw new Error("assignee_not_found");
      }
      const nextStatus = action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : action === "RESOLVE" ? "RESOLVED" : action === "REOPEN" ? "OPEN" : action === "CANCEL" ? "CANCELLED" : row.status;
      const eventType = action === "COMMENT" ? "COMMENTED" : action === "REASSIGN" ? "REASSIGNED" : action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : action === "RESOLVE" ? "RESOLVED" : action === "REOPEN" ? "REOPENED" : action === "CANCEL" ? "CANCELLED" : "UPDATED";
      const privateData = decryptOperationalData<PrivateData>(row.privateDataCiphertext, ctx(row.organizationId, row.centreId, row.id));
      const updateFields: { severity?: string; priority?: string; dueAt?: Date } = {};
      if (action === "UPDATE") {
        if (parsed.data.severity !== undefined) updateFields.severity = parsed.data.severity;
        if (parsed.data.priority !== undefined) updateFields.priority = parsed.data.priority;
        if (parsed.data.dueAt !== undefined) updateFields.dueAt = new Date(parsed.data.dueAt);
        privateData.reason = parsed.data.reason;
      }
      if (action === "REOPEN") updateFields.dueAt = new Date(parsed.data.dueAt);
      if ("reason" in parsed.data) privateData.reason = parsed.data.reason;
      await tx.update(staffEscalations).set({ ...updateFields, ...(action === "COMMENT" ? {} : { privateDataCiphertext: encryptOperationalData(privateData, ctx(row.organizationId, row.centreId, row.id)) }), assignedOwnerStaffId: nextOwner, status: nextStatus, resolvedByStaffId: nextStatus === "RESOLVED" ? actor.staffUserId : null, resolvedAt: nextStatus === "RESOLVED" ? new Date() : null, versionNumber: row.versionNumber + 1, updatedAt: new Date() }).where(and(eq(staffEscalations.id, row.id), eq(staffEscalations.versionNumber, row.versionNumber)));
      const eventId = randomUUID();
      await tx.insert(staffEscalationEvents).values({ id: eventId, organizationId: row.organizationId, centreId: row.centreId, escalationId: row.id, eventType, privateDataCiphertext: encryptOperationalData({ reason: "reason" in parsed.data ? parsed.data.reason : null, comment: action === "COMMENT" ? parsed.data.comment : null, assignedOwnerStaffId: nextOwner, ...updateFields, result: { status: nextStatus, versionNumber: row.versionNumber + 1 } }, eventCtx(row.organizationId, row.centreId, eventId)), actorStaffId: actor.staffUserId, idempotencyKey, requestHash });
      await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: actor.staffUserId, action: `staff_escalation.${action.toLowerCase()}`, entityType: "staff_escalation", entityId: row.id, details: { status: nextStatus, version: row.versionNumber + 1 } });
      return { id: row.id, status: nextStatus, versionNumber: row.versionNumber + 1, replayed: false };
    });
    return Response.json({ escalation: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "not_found" ? 404 : code === "forbidden" ? 403 : ["version_conflict", "idempotency_conflict", "invalid_transition"].includes(code) ? 409 : ["assignee_not_found", "due_date_must_be_future"].includes(code) ? 400 : 500;
    return Response.json({ error: ["not_found", "forbidden", "version_conflict", "idempotency_conflict", "invalid_transition", "assignee_not_found", "due_date_must_be_future"].includes(code) ? code : "escalation_update_failed" }, { status });
  }
}
