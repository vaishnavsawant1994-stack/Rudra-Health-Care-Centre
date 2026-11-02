import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { communicationTemplateEvents, communicationTemplates, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { hasLeadCentrePermission } from "@/server/lead-policy";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { communicationTemplateContentSchema, communicationTemplatePatchSchema } from "@/server/communication-template-policy";

const idSchema = z.uuid();
type Context = { params: Promise<{ id: string }> };
type PrivateTemplate = { name: string; body: string };
const templateContext = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "communication-template");
const eventContext = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "communication-template-event");

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("leads.followups.manage");
  if (access.response) return access.response;
  const db = getDb();
  const [row] = await db.select().from(communicationTemplates).where(and(eq(communicationTemplates.id, id), eq(communicationTemplates.organizationId, access.staff.organizationId))).limit(1);
  if (!row || !hasLeadCentrePermission(access.staff.grants, "leads.followups.manage", row.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const events = await db.select({ id: communicationTemplateEvents.id, eventType: communicationTemplateEvents.eventType, privateDataCiphertext: communicationTemplateEvents.privateDataCiphertext, recordedAt: communicationTemplateEvents.recordedAt, actorName: staffUsers.displayName, actorCode: staffUsers.staffCode })
    .from(communicationTemplateEvents).innerJoin(staffUsers, and(eq(staffUsers.id, communicationTemplateEvents.actorStaffId), eq(staffUsers.organizationId, communicationTemplateEvents.organizationId)))
    .where(and(eq(communicationTemplateEvents.organizationId, row.organizationId), eq(communicationTemplateEvents.centreId, row.centreId), eq(communicationTemplateEvents.templateId, row.id))).orderBy(asc(communicationTemplateEvents.recordedAt), asc(communicationTemplateEvents.id)).limit(100);
  return Response.json({ template: { id: row.id, centreId: row.centreId, purpose: row.purpose, channel: row.channel, status: row.status, versionNumber: row.versionNumber, ...decryptOperationalData<PrivateTemplate>(row.privateDataCiphertext, templateContext(row.organizationId, row.centreId, row.id)), createdAt: row.createdAt, updatedAt: row.updatedAt }, history: events.map((event) => ({ id: event.id, eventType: event.eventType, ...decryptOperationalData<Record<string, unknown>>(event.privateDataCiphertext, eventContext(row.organizationId, row.centreId, event.id)), recordedAt: event.recordedAt, actor: `${event.actorName} (${event.actorCode})` })), delivery: "DISABLED" }, { headers: { "cache-control": "private, no-store" } });
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = communicationTemplatePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_template_action" }, { status: 400 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idSchema.safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const access = await getApiAccess("leads.followups.manage");
  if (access.response) return access.response;
  const requestPayload = { templateId: id, actorStaffId: access.staff.staffUserId, ...parsed.data };
  const legacyRequestHash = createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex");
  try {
    const outcome = await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(communicationTemplates).where(and(eq(communicationTemplates.id, id), eq(communicationTemplates.organizationId, access.staff.organizationId))).for("update").limit(1);
      if (!row || !hasLeadCentrePermission(access.staff.grants, "leads.followups.manage", row.centreId)) throw new Error("not_found");
      const fingerprintContext = operationalContext({ organizationId: row.organizationId, centreId: row.centreId, recordId: `${id}:${idempotencyKey}` }, "communication-template-update-idempotency");
      const requestHash = fingerprintOperationalRequest(requestPayload, fingerprintContext);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${row.organizationId}:communication-template-action:${idempotencyKey}`}, 0))`);
      const [replay] = await tx.select().from(communicationTemplateEvents).where(and(eq(communicationTemplateEvents.organizationId, row.organizationId), eq(communicationTemplateEvents.idempotencyKey, idempotencyKey!))).limit(1);
      if (replay) {
        if (replay.templateId !== row.id || replay.actorStaffId !== access.staff.staffUserId || (!verifyOperationalRequestFingerprint(requestPayload, replay.requestHash, operationalContext({ organizationId: row.organizationId, centreId: "operation-scoped", recordId: `${id}:${idempotencyKey}` }, "communication-template-update-idempotency")) && replay.requestHash !== legacyRequestHash)) throw new Error("idempotency_conflict");
        const snapshot = decryptOperationalData<Record<string, unknown>>(replay.privateDataCiphertext, eventContext(row.organizationId, row.centreId, replay.id));
        return { template: { id: row.id, centreId: row.centreId, purpose: row.purpose, channel: row.channel, ...snapshot }, replayed: true };
      }
      if (row.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
      const previous = decryptOperationalData<PrivateTemplate>(row.privateDataCiphertext, templateContext(row.organizationId, row.centreId, row.id));
      let nextPrivate = previous;
      let nextStatus = row.status;
      let eventType: "UPDATED" | "ACTIVATED" | "ARCHIVED";
      if (parsed.data.action === "UPDATE") {
        if (row.status !== "DRAFT") throw new Error("template_not_editable");
        nextPrivate = { ...previous, ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }), ...(parsed.data.body === undefined ? {} : { body: parsed.data.body }) };
        const valid = communicationTemplateContentSchema.safeParse(nextPrivate);
        if (!valid.success) throw new Error("invalid_template");
        eventType = "UPDATED";
      } else if (parsed.data.action === "ACTIVATE") {
        if (row.status !== "DRAFT") throw new Error("invalid_transition");
        nextStatus = "ACTIVE"; eventType = "ACTIVATED";
      } else {
        if (row.status === "ARCHIVED") throw new Error("invalid_transition");
        nextStatus = "ARCHIVED"; eventType = "ARCHIVED";
      }
      const nextVersion = row.versionNumber + 1;
      const [updated] = await tx.update(communicationTemplates).set({ status: nextStatus, versionNumber: nextVersion, privateDataCiphertext: encryptOperationalData(nextPrivate, templateContext(row.organizationId, row.centreId, row.id)), updatedByStaffId: access.staff.staffUserId, updatedAt: new Date() }).where(and(eq(communicationTemplates.id, row.id), eq(communicationTemplates.versionNumber, row.versionNumber))).returning({ id: communicationTemplates.id });
      if (!updated) throw new Error("version_conflict");
      const eventId = randomUUID();
      const reason = "reason" in parsed.data ? parsed.data.reason : undefined;
      const snapshot = { ...nextPrivate, status: nextStatus, versionNumber: nextVersion, ...(reason ? { reason } : {}) };
      await tx.insert(communicationTemplateEvents).values({ id: eventId, organizationId: row.organizationId, centreId: row.centreId, templateId: row.id, actorStaffId: access.staff.staffUserId, eventType, privateDataCiphertext: encryptOperationalData(snapshot, eventContext(row.organizationId, row.centreId, eventId)), idempotencyKey: idempotencyKey!, requestHash });
      await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: access.staff.staffUserId, action: `communication.template_${eventType.toLowerCase()}`, entityType: "communication_template", entityId: row.id, details: { status: nextStatus, version: nextVersion, purpose: row.purpose, channel: row.channel } });
      return { template: { id: row.id, centreId: row.centreId, purpose: row.purpose, channel: row.channel, ...snapshot }, replayed: false };
    });
    return Response.json({ ...outcome, delivery: "DISABLED" }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "not_found" ? 404 : code === "idempotency_conflict" || code === "version_conflict" || code === "template_not_editable" || code === "invalid_transition" ? 409 : code === "invalid_template" ? 400 : 500;
    return Response.json({ error: status === 500 ? "template_unavailable" : code }, { status });
  }
}
