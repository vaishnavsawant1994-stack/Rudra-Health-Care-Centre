import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { communicationTemplateEvents, communicationTemplates } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { hasLeadCentrePermission } from "@/server/lead-policy";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { communicationTemplateCreateSchema } from "@/server/communication-template-policy";

const querySchema = z.object({ centreId: z.uuid(), status: z.enum(["ALL", "DRAFT", "ACTIVE", "ARCHIVED"]).default("ALL") });
type TemplatePrivate = { name: string; body: string };
const context = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "communication-template");
const toTemplate = (row: typeof communicationTemplates.$inferSelect) => ({ id: row.id, centreId: row.centreId, purpose: row.purpose, channel: row.channel, status: row.status, versionNumber: row.versionNumber, ...decryptOperationalData<TemplatePrivate>(row.privateDataCiphertext, context(row.organizationId, row.centreId, row.id)), createdAt: row.createdAt, updatedAt: row.updatedAt });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const { centreId, status } = parsed.data;
  const access = await getApiAccess("leads.followups.manage", centreId);
  if (access.response) return access.response;
  if (!hasLeadCentrePermission(access.staff.grants, "leads.followups.manage", centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const rows = await getDb().select().from(communicationTemplates).where(and(
    eq(communicationTemplates.organizationId, access.staff.organizationId), eq(communicationTemplates.centreId, centreId),
    status === "ALL" ? undefined : eq(communicationTemplates.status, status),
  )).orderBy(desc(communicationTemplates.updatedAt), desc(communicationTemplates.id)).limit(100);
  return Response.json({ templates: rows.map(toTemplate), delivery: "DISABLED" }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = communicationTemplateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_template" }, { status: 400 });
  const data = parsed.data;
  const access = await getApiAccess("leads.followups.manage", data.centreId);
  if (access.response) return access.response;
  if (!hasLeadCentrePermission(access.staff.grants, "leads.followups.manage", data.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const fingerprintContext = operationalContext({ organizationId: access.staff.organizationId, centreId: data.centreId, recordId: data.idempotencyKey }, "communication-template-create-idempotency");
  const requestHash = fingerprintOperationalRequest(data, fingerprintContext);
  const legacyRequestHash = createHash("sha256").update(JSON.stringify({ centreId: data.centreId, purpose: data.purpose, channel: data.channel, name: data.name, body: data.body })).digest("hex");
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:communication-template:${data.idempotencyKey}`}, 0))`);
      const [existing] = await tx.select().from(communicationTemplates).where(and(eq(communicationTemplates.organizationId, access.staff.organizationId), eq(communicationTemplates.idempotencyKey, data.idempotencyKey))).limit(1);
      if (existing) {
        if ((!verifyOperationalRequestFingerprint(data, existing.requestHash, fingerprintContext) && existing.requestHash !== legacyRequestHash) || existing.createdByStaffId !== access.staff.staffUserId) throw new Error("idempotency_conflict");
        return { row: existing, replayed: true };
      }
      const id = randomUUID();
      const [row] = await tx.insert(communicationTemplates).values({ id, organizationId: access.staff.organizationId, centreId: data.centreId, createdByStaffId: access.staff.staffUserId, updatedByStaffId: access.staff.staffUserId, purpose: data.purpose, channel: data.channel, status: "DRAFT", versionNumber: 1, privateDataCiphertext: encryptOperationalData({ name: data.name, body: data.body }, context(access.staff.organizationId, data.centreId, id)), idempotencyKey: data.idempotencyKey, requestHash }).returning();
      const eventId = randomUUID();
      await tx.insert(communicationTemplateEvents).values({ id: eventId, organizationId: access.staff.organizationId, centreId: data.centreId, templateId: id, actorStaffId: access.staff.staffUserId, eventType: "CREATED", privateDataCiphertext: encryptOperationalData({ name: data.name, body: data.body, status: "DRAFT", versionNumber: 1 }, operationalContext({ organizationId: access.staff.organizationId, centreId: data.centreId, recordId: eventId }, "communication-template-event")), idempotencyKey: data.idempotencyKey, requestHash });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: data.centreId, actorStaffId: access.staff.staffUserId, action: "communication.template_created", entityType: "communication_template", entityId: id, details: { purpose: data.purpose, channel: data.channel, status: "DRAFT" } });
      return { row, replayed: false };
    });
    return Response.json({ template: toTemplate(result.row), replayed: result.replayed, delivery: "DISABLED" }, { status: result.replayed ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "idempotency_conflict" ? "idempotency_conflict" : "template_unavailable" }, { status: 409 });
  }
}
