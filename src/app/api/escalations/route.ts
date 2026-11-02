import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { permissions, rolePermissions, roles, staffEscalations, staffEscalationEvents, staffRoleAssignments, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { resolveTaskReference, type TaskReference } from "@/server/task-reference";
import { canManageEscalation, escalationReadScope } from "@/server/staff-escalation-policy";
import { escalationRequestFingerprint, legacyEscalationRequestFingerprint, sameEscalationPrivateRequest } from "@/server/escalation-request-fingerprint";

const uuid = z.uuid();
const ESCALATION_PAGE_SIZE = 100;
const createSchema = z.object({ centreId: uuid, source: z.object({ type: z.enum(["APPOINTMENT", "LEAD", "LEAD_FOLLOWUP", "PUBLIC_ENQUIRY", "COLLECTION_JOB", "SAMPLE_EXCEPTION", "REPORT", "REPORT_FOLLOWUP", "FINANCE_PAYMENT", "FINANCE_REFUND", "STAFF_TASK", "CORPORATE_RELATIONSHIP", "PARTNER_RELATIONSHIP", "DOCTOR_RELATIONSHIP"]), id: uuid }), title: z.string().trim().min(3).max(120), description: z.string().trim().max(2000).default(""), severity: z.enum(["LOW", "MODERATE", "HIGH", "URGENT"]), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]), assignedOwnerStaffId: uuid, dueAt: z.iso.datetime(), deduplicateOpenSource: z.boolean().default(false) });
type EscalationPrivate = { title: string; description: string; reason?: string };
const context = (org: string, centre: string, id: string) => operationalContext({ organizationId: org, centreId: centre, recordId: id }, "staff-escalation");
const eventContext = (org: string, centre: string, id: string) => operationalContext({ organizationId: org, centreId: centre, recordId: id }, "staff-escalation-event");

async function readAccess(centreId?: string) {
  const broad = await getApiAccess("escalations.read", centreId);
  if (!broad.response) return { ...broad, assignedOnly: false } as const;
  const assigned = await getApiAccess("escalations.assigned.read", centreId);
  if (!assigned.response) return { ...assigned, assignedOnly: true } as const;
  return broad;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pageValue = params.get("page") ?? "1";
  if (!/^\d+$/.test(pageValue) || Number(pageValue) < 1 || Number(pageValue) > 100_000) return Response.json({ error: "invalid_page" }, { status: 400 });
  const page = Number(pageValue);
  const centreId = params.get("centreId") ?? undefined;
  const status = params.get("status") ?? undefined;
  const severity = params.get("severity") ?? undefined;
  const priority = params.get("priority") ?? undefined;
  if (centreId && !uuid.safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  if (status && !["OPEN", "ACKNOWLEDGED", "RESOLVED", "CANCELLED", "OVERDUE"].includes(status)) return Response.json({ error: "invalid_status" }, { status: 400 });
  if (severity && !["LOW", "MODERATE", "HIGH", "URGENT"].includes(severity)) return Response.json({ error: "invalid_severity" }, { status: 400 });
  if (priority && !["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) return Response.json({ error: "invalid_priority" }, { status: 400 });
  const access = await readAccess(centreId);
  if (access.response) return access.response;
  const staff = access.staff;
  const clauses = [eq(staffEscalations.organizationId, staff.organizationId)];
  const visibility = escalationReadScope(staff.grants, staff.staffUserId);
  if (centreId) {
    clauses.push(eq(staffEscalations.centreId, centreId));
    if (!visibility.allCentresBroad && !visibility.broadCentres.includes(centreId)) {
      const assignedHere = visibility.assignedEverywhere || visibility.assignedCentres.includes(centreId);
      if (assignedHere) clauses.push(eq(staffEscalations.assignedOwnerStaffId, staff.staffUserId));
    }
  } else if (!visibility.allCentresBroad) {
    const scopeConditions = [];
    if (visibility.broadCentres.length) scopeConditions.push(inArray(staffEscalations.centreId, visibility.broadCentres));
    if (visibility.assignedEverywhere) scopeConditions.push(eq(staffEscalations.assignedOwnerStaffId, staff.staffUserId));
    else if (visibility.assignedCentres.length) scopeConditions.push(and(inArray(staffEscalations.centreId, visibility.assignedCentres), eq(staffEscalations.assignedOwnerStaffId, staff.staffUserId))!);
    if (scopeConditions.length) clauses.push(or(...scopeConditions)!);
    else return Response.json({ escalations: [], page, pageSize: ESCALATION_PAGE_SIZE, hasMore: false });
  }
  if (status && status !== "OVERDUE") clauses.push(eq(staffEscalations.status, status));
  if (status === "OVERDUE") clauses.push(and(inArray(staffEscalations.status, ["OPEN", "ACKNOWLEDGED"]), lt(staffEscalations.dueAt, new Date()))!);
  if (severity) clauses.push(eq(staffEscalations.severity, severity));
  if (priority) clauses.push(eq(staffEscalations.priority, priority));
  const rows = await getDb().select({ id: staffEscalations.id, organizationId: staffEscalations.organizationId, centreId: staffEscalations.centreId, escalationNumber: staffEscalations.escalationNumber, sourceType: staffEscalations.sourceType, sourceId: staffEscalations.sourceId, privateDataCiphertext: staffEscalations.privateDataCiphertext, severity: staffEscalations.severity, priority: staffEscalations.priority, status: staffEscalations.status, ownerName: staffUsers.displayName, dueAt: staffEscalations.dueAt, versionNumber: staffEscalations.versionNumber, createdAt: staffEscalations.createdAt }).from(staffEscalations).innerJoin(staffUsers, and(eq(staffUsers.id, staffEscalations.assignedOwnerStaffId), eq(staffUsers.organizationId, staffEscalations.organizationId))).where(and(...clauses)).orderBy(asc(staffEscalations.dueAt), desc(staffEscalations.createdAt), asc(staffEscalations.id)).limit(ESCALATION_PAGE_SIZE + 1).offset((page - 1) * ESCALATION_PAGE_SIZE);
  const hasMore = rows.length > ESCALATION_PAGE_SIZE;
  const pageRows = rows.slice(0, ESCALATION_PAGE_SIZE);
  const escalations = await Promise.all(pageRows.map(async ({ privateDataCiphertext, organizationId, centreId: rowCentre, id, sourceType, sourceId, ...row }) => {
    const source = await resolveTaskReference(staff, rowCentre, { type: sourceType as TaskReference["type"], id: sourceId });
    if (!source) return null;
    const privateData = decryptOperationalData<EscalationPrivate>(privateDataCiphertext, context(organizationId, rowCentre, id));
    return { ...row, id, ...privateData, centreId: rowCentre, canManage: canManageEscalation(staff.grants, rowCentre), source: { type: sourceType, id: sourceId, label: source }, overdue: new Date(row.dueAt) < new Date() && ["OPEN", "ACKNOWLEDGED"].includes(row.status) };
  }));
  return Response.json({ escalations: escalations.filter(Boolean), page, pageSize: ESCALATION_PAGE_SIZE, hasMore });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const key = request.headers.get("idempotency-key");
  if (!uuid.safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_escalation", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const data = parsed.data;
  if (new Date(data.dueAt) <= new Date()) return Response.json({ error: "due_date_must_be_future" }, { status: 400 });
  const access = await getApiAccess("escalations.create", data.centreId);
  if (access.response) return access.response;
  const staff = access.staff;
  if (data.assignedOwnerStaffId !== staff.staffUserId) {
    const manage = await getApiAccess("escalations.manage", data.centreId);
    if (manage.response) return manage.response;
  }
  const sourceLabel = await resolveTaskReference(staff, data.centreId, data.source, { forEscalationCreation: true });
  if (!sourceLabel) return Response.json({ error: "source_not_found_or_forbidden" }, { status: 404 });
  const [assignee] = await getDb().select({ id: staffUsers.id }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt))).innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), inArray(permissions.key, ["escalations.read", "escalations.assigned.read"]))).where(and(eq(staffUsers.id, data.assignedOwnerStaffId), eq(staffUsers.organizationId, staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, data.centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
  if (!assignee) return Response.json({ error: "assignee_not_found" }, { status: 400 });
  const requestHash = escalationRequestFingerprint(data);
  const legacyRequestHash = legacyEscalationRequestFingerprint(data);
  const id = randomUUID();
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${staff.organizationId}:escalation:${key}`}, 0))`);
      const prior = await tx.select({ id: staffEscalations.id, escalationNumber: staffEscalations.escalationNumber, requestHash: staffEscalations.requestHash, privateDataCiphertext: staffEscalations.privateDataCiphertext, centreId: staffEscalations.centreId, assignedOwnerStaffId: staffEscalations.assignedOwnerStaffId }).from(staffEscalations).where(and(eq(staffEscalations.organizationId, staff.organizationId), eq(staffEscalations.idempotencyKey, key!))).limit(1);
      if (prior[0]) {
        const priorPrivate = decryptOperationalData<EscalationPrivate>(prior[0].privateDataCiphertext, context(staff.organizationId, prior[0].centreId, prior[0].id));
        const requestMatches = prior[0].requestHash === requestHash || (prior[0].requestHash === legacyRequestHash && sameEscalationPrivateRequest(priorPrivate, data));
        if (!requestMatches || !sameEscalationPrivateRequest(priorPrivate, data)) throw new Error("idempotency_conflict");
        const read = await readAccess(prior[0].centreId);
        if (read.response || (read.assignedOnly && prior[0].assignedOwnerStaffId !== read.staff.staffUserId)) throw new Error("forbidden");
        return { id: prior[0].id, escalationNumber: prior[0].escalationNumber, replayed: true };
      }
      const priorEventResult = await tx.select({ escalationId: staffEscalationEvents.escalationId, centreId: staffEscalationEvents.centreId, requestHash: staffEscalationEvents.requestHash, privateDataCiphertext: staffEscalationEvents.privateDataCiphertext, eventId: staffEscalationEvents.id }).from(staffEscalationEvents).where(and(eq(staffEscalationEvents.organizationId, staff.organizationId), eq(staffEscalationEvents.idempotencyKey, key!))).limit(1);
      const priorEvent = priorEventResult[0];
      if (priorEvent) {
        const eventResult = decryptOperationalData<{ result?: { alreadyOpen?: boolean }; privateRequest?: { title?: string; description?: string } }>(priorEvent.privateDataCiphertext, eventContext(staff.organizationId, priorEvent.centreId, priorEvent.eventId));
        const hashMatches = priorEvent.requestHash === requestHash || priorEvent.requestHash === legacyRequestHash;
        if (!hashMatches || !sameEscalationPrivateRequest(eventResult.privateRequest, data)) throw new Error("idempotency_conflict");
        if (!eventResult.result) throw new Error("idempotency_result_unavailable");
        return { replayed: true, alreadyOpen: eventResult.result.alreadyOpen === true };
      }
      if (data.deduplicateOpenSource) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${staff.organizationId}:open-escalation-source:${data.centreId}:${data.source.type}:${data.source.id}`}, 0))`);
        const [open] = await tx.select({ id: staffEscalations.id, escalationNumber: staffEscalations.escalationNumber }).from(staffEscalations)
          .where(and(eq(staffEscalations.organizationId, staff.organizationId), eq(staffEscalations.centreId, data.centreId), eq(staffEscalations.sourceType, data.source.type), eq(staffEscalations.sourceId, data.source.id), inArray(staffEscalations.status, ["OPEN", "ACKNOWLEDGED"])))
          .for("update").limit(1);
        if (open) {
          const eventId = randomUUID();
          await tx.insert(staffEscalationEvents).values({ id: eventId, organizationId: staff.organizationId, centreId: data.centreId, escalationId: open.id, eventType: "DUPLICATE_SUPPRESSED", privateDataCiphertext: encryptOperationalData({ result: { alreadyOpen: true }, privateRequest: { title: data.title, description: data.description }, sourceType: data.source.type }, eventContext(staff.organizationId, data.centreId, eventId)), actorStaffId: staff.staffUserId, idempotencyKey: key!, requestHash });
          await appendAuditEvent(tx, { organizationId: staff.organizationId, centreId: data.centreId, actorStaffId: staff.staffUserId, action: "staff_escalation.duplicate_create_suppressed", entityType: "staff_escalation", entityId: open.id, details: { sourceType: data.source.type } });
          return { replayed: false, alreadyOpen: true };
        }
      }
      const [eligibleOwner] = await tx.select({ id: staffUsers.id }).from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt))).innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), inArray(permissions.key, ["escalations.read", "escalations.assigned.read"]))).where(and(eq(staffUsers.id, data.assignedOwnerStaffId), eq(staffUsers.organizationId, staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, data.centreId), isNull(staffRoleAssignments.centreId)))).limit(1);
      if (!eligibleOwner) throw new Error("assignee_not_found");
      const privateData = { title: data.title, description: data.description };
      const [created] = await tx.insert(staffEscalations).values({ id, organizationId: staff.organizationId, centreId: data.centreId, escalationNumber: `RHC-E-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`, sourceType: data.source.type, sourceId: data.source.id, privateDataCiphertext: encryptOperationalData(privateData, context(staff.organizationId, data.centreId, id)), severity: data.severity, priority: data.priority, status: "OPEN", assignedOwnerStaffId: data.assignedOwnerStaffId, createdByStaffId: staff.staffUserId, dueAt: new Date(data.dueAt), idempotencyKey: key!, requestHash }).returning({ id: staffEscalations.id, escalationNumber: staffEscalations.escalationNumber });
      const eventId = randomUUID();
      await tx.insert(staffEscalationEvents).values({ id: eventId, organizationId: staff.organizationId, centreId: data.centreId, escalationId: id, eventType: "CREATED", privateDataCiphertext: encryptOperationalData({ title: "Escalation created", assignedOwnerStaffId: data.assignedOwnerStaffId, sourceLabel }, eventContext(staff.organizationId, data.centreId, eventId)), actorStaffId: staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: staff.organizationId, centreId: data.centreId, actorStaffId: staff.staffUserId, action: "staff_escalation.created", entityType: "staff_escalation", entityId: id, details: { sourceType: data.source.type, severity: data.severity, priority: data.priority } });
      return { ...created, replayed: false, alreadyOpen: false };
    });
    return Response.json({ escalation: result }, { status: result.replayed || result.alreadyOpen ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return Response.json({ error: ["idempotency_conflict", "assignee_not_found"].includes(code) ? code : "escalation_creation_failed" }, { status: code === "idempotency_conflict" ? 409 : code === "assignee_not_found" ? 400 : 500 });
  }
}
