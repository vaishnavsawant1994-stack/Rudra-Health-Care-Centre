import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appointments, centres, communicationTemplates, leadCommunicationDraftEvents, leadCommunicationDrafts, leadPrivateData, leads } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptLeadPrivateData, decryptLeadValue, encryptLeadValue } from "@/server/lead-crypto";
import { communicationDraftDenial, hasLeadCentrePermission } from "@/server/lead-policy";
import { decryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { renderCommunicationTemplate } from "@/server/communication-template-policy";

const idSchema = z.uuid();
const draftSchema = z.object({
  idempotencyKey: z.uuid(),
  purpose: z.enum(["OPERATIONAL", "MARKETING"]),
  channel: z.enum(["PHONE", "EMAIL", "WHATSAPP"]),
  body: z.string().trim().min(1).max(2000).optional(),
  templateId: z.uuid().optional(),
  templateVersion: z.number().int().positive().optional(),
}).strict().refine((value) => Boolean(value.body) !== Boolean(value.templateId) && Boolean(value.templateId) === Boolean(value.templateVersion), "Provide either draft text or a versioned template.");
const cancelDraftSchema = z.object({
  draftId: z.uuid(),
  action: z.literal("CANCEL"),
  expectedUpdatedAt: z.iso.datetime(),
}).strict();
type Context = { params: Promise<{ id: string }> };
type TemplatePrivate = { name: string; body: string };
const templateContext = (organizationId: string, centreId: string, templateId: string) => operationalContext({ organizationId, centreId, recordId: templateId }, "communication-template");
const draftContext = (organizationId: string, centreId: string, draftId: string) => ({ organizationId, centreId, recordId: draftId });

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const view = new URL(request.url).searchParams.get("view") ?? "drafts";
  if (view !== "drafts" && view !== "templates") return Response.json({ error: "invalid_view" }, { status: 400 });
  const access = await getApiAccess(view === "templates" ? "leads.activities.write" : "leads.read");
  if (access.response) return access.response;
  const db = getDb();
  const [lead] = await db.select({ id: leads.id, organizationId: leads.organizationId, centreId: leads.centreId, preferredChannel: leads.preferredChannel, marketingConsent: leads.marketingConsent })
    .from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).limit(1);
  if (!lead || !hasLeadCentrePermission(access.staff.grants, view === "templates" ? "leads.activities.write" : "leads.read", lead.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (view === "templates") {
    const templateAccess = await getApiAccess("leads.followups.manage", lead.centreId);
    if (templateAccess.response || templateAccess.staff.organizationId !== access.staff.organizationId || templateAccess.staff.staffUserId !== access.staff.staffUserId || !hasLeadCentrePermission(templateAccess.staff.grants, "leads.followups.manage", lead.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
    const templates = await db.select().from(communicationTemplates).where(and(
      eq(communicationTemplates.organizationId, lead.organizationId), eq(communicationTemplates.centreId, lead.centreId), eq(communicationTemplates.status, "ACTIVE"),
      eq(communicationTemplates.channel, lead.preferredChannel),
      lead.marketingConsent === "GRANTED" ? undefined : eq(communicationTemplates.purpose, "OPERATIONAL"),
    )).orderBy(desc(communicationTemplates.updatedAt), asc(communicationTemplates.id)).limit(100);
    return Response.json({ templates: templates.map((row) => ({ id: row.id, purpose: row.purpose, channel: row.channel, version: row.versionNumber, name: decryptOperationalData<TemplatePrivate>(row.privateDataCiphertext, templateContext(row.organizationId, row.centreId, row.id)).name })), delivery: "DISABLED" }, { headers: { "cache-control": "private, no-store" } });
  }
  const rows = await db.select().from(leadCommunicationDrafts)
    .where(and(eq(leadCommunicationDrafts.leadId, id), eq(leadCommunicationDrafts.organizationId, lead.organizationId), eq(leadCommunicationDrafts.centreId, lead.centreId)))
    .orderBy(desc(leadCommunicationDrafts.createdAt)).limit(100);
  return Response.json({ drafts: rows.map((row) => ({
    id: row.id, purpose: row.purpose, channel: row.channel, status: row.status, templateId: row.templateId, templateVersion: row.templateVersion, createdAt: row.createdAt, updatedAt: row.updatedAt,
    body: decryptLeadValue<string>("communication-draft", row.bodyCiphertext, { organizationId: row.organizationId, centreId: row.centreId, recordId: row.id }),
  })) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("leads.activities.write");
  if (access.response) return access.response;
  const db = getDb();
  const [initial] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).limit(1);
  if (!initial || !hasLeadCentrePermission(access.staff.grants, "leads.activities.write", initial.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (parsed.data.templateId) {
    const templateAccess = await getApiAccess("leads.followups.manage", initial.centreId);
    if (templateAccess.response || templateAccess.staff.organizationId !== access.staff.organizationId || templateAccess.staff.staffUserId !== access.staff.staffUserId || !hasLeadCentrePermission(templateAccess.staff.grants, "leads.followups.manage", initial.centreId)) return Response.json({ error: "template_unavailable" }, { status: 404 });
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [lead] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).for("update").limit(1);
      if (!lead || !hasLeadCentrePermission(access.staff.grants, "leads.activities.write", lead.centreId)) throw new Error("lead_unavailable");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${lead.organizationId}:${parsed.data.idempotencyKey}`}, 0))`);
      const denial = communicationDraftDenial({ ...parsed.data, status: lead.status, contactPermission: lead.contactPermission, preferredChannel: lead.preferredChannel, marketingConsent: lead.marketingConsent });
      if (denial) throw new Error(denial);
      const [existing] = await tx.select().from(leadCommunicationDrafts).where(and(eq(leadCommunicationDrafts.organizationId, lead.organizationId), eq(leadCommunicationDrafts.idempotencyKey, parsed.data.idempotencyKey))).limit(1);
      if (existing) {
        const sameSource = parsed.data.templateId ? existing.templateId === parsed.data.templateId && existing.templateVersion === parsed.data.templateVersion : existing.templateId === null && existing.templateVersion === null;
        const sameBody = parsed.data.body === undefined || decryptLeadValue<string>("communication-draft", existing.bodyCiphertext, draftContext(existing.organizationId, existing.centreId, existing.id)) === parsed.data.body;
        if (existing.leadId !== lead.id || existing.createdByStaffId !== access.staff.staffUserId || existing.centreId !== lead.centreId || existing.purpose !== parsed.data.purpose || existing.channel !== parsed.data.channel || !sameSource || !sameBody) throw new Error("idempotency_conflict");
        return { id: existing.id, status: existing.status, createdAt: existing.createdAt, replayed: true };
      }
      let body = parsed.data.body;
      let templateId: string | null = null;
      let templateVersion: number | null = null;
      if (parsed.data.templateId) {
        const [template] = await tx.select().from(communicationTemplates).where(and(
          eq(communicationTemplates.id, parsed.data.templateId), eq(communicationTemplates.organizationId, lead.organizationId),
          eq(communicationTemplates.centreId, lead.centreId), eq(communicationTemplates.status, "ACTIVE"),
          eq(communicationTemplates.purpose, parsed.data.purpose), eq(communicationTemplates.channel, parsed.data.channel),
          eq(communicationTemplates.versionNumber, parsed.data.templateVersion!),
        )).for("update").limit(1);
        if (!template) throw new Error("template_unavailable");
        const [privateRow] = await tx.select({ payloadCiphertext: leadPrivateData.payloadCiphertext }).from(leadPrivateData).where(and(
          eq(leadPrivateData.leadId, lead.id), eq(leadPrivateData.organizationId, lead.organizationId), eq(leadPrivateData.centreId, lead.centreId),
        )).limit(1);
        const [centre] = await tx.select({ name: centres.name, timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, lead.centreId), eq(centres.organizationId, lead.organizationId))).limit(1);
        if (!privateRow || !centre) throw new Error("template_data_unavailable");
        const privateData = decryptLeadPrivateData(privateRow.payloadCiphertext, { organizationId: lead.organizationId, centreId: lead.centreId, recordId: lead.id });
        const [nextAppointment] = await tx.select({ scheduledAt: appointments.scheduledAt, timeZone: appointments.timeZone }).from(appointments).where(and(
          eq(appointments.leadId, lead.id), eq(appointments.organizationId, lead.organizationId), eq(appointments.centreId, lead.centreId),
          inArray(appointments.status, ["CONFIRMED", "ASSIGNED", "RESCHEDULED"]), gte(appointments.scheduledAt, new Date()),
        )).orderBy(asc(appointments.scheduledAt)).limit(1);
        const sourceTemplate = decryptOperationalData<TemplatePrivate>(template.privateDataCiphertext, templateContext(template.organizationId, template.centreId, template.id));
        const rendered = renderCommunicationTemplate(sourceTemplate.body, {
          firstName: privateData.firstName,
          leadNumber: lead.leadNumber,
          serviceName: privateData.interestedService ?? undefined,
          centreName: centre.name,
          appointmentDate: nextAppointment ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: nextAppointment.timeZone || centre.timeZone }).format(nextAppointment.scheduledAt) : undefined,
        });
        if (!rendered.ok) throw new Error("template_data_unavailable");
        body = rendered.body;
        templateId = template.id;
        templateVersion = template.versionNumber;
      }
      if (!body) throw new Error("draft_body_required");
      const draftId = randomUUID();
      const [draft] = await tx.insert(leadCommunicationDrafts).values({
        id: draftId,
        organizationId: lead.organizationId, centreId: lead.centreId, leadId: lead.id,
        createdByStaffId: access.staff.staffUserId, purpose: parsed.data.purpose, channel: parsed.data.channel,
        bodyCiphertext: encryptLeadValue("communication-draft", body, { organizationId: lead.organizationId, centreId: lead.centreId, recordId: draftId }),
        templateId, templateVersion,
        idempotencyKey: parsed.data.idempotencyKey,
      }).returning({ id: leadCommunicationDrafts.id, status: leadCommunicationDrafts.status, createdAt: leadCommunicationDrafts.createdAt });
      await tx.insert(leadCommunicationDraftEvents).values({ organizationId: lead.organizationId, centreId: lead.centreId, draftId, actorStaffId: access.staff.staffUserId, eventType: "CREATED" });
      await appendAuditEvent(tx, { organizationId: lead.organizationId, centreId: lead.centreId, actorStaffId: access.staff.staffUserId, action: "lead.communication_draft_created", entityType: "lead", entityId: lead.id, details: { draftId, purpose: parsed.data.purpose, channel: parsed.data.channel, templateVersion: templateVersion ?? null } });
      return { ...draft, templateId, templateVersion, replayed: false };
    });
    return Response.json({ draft: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "contact_permission_required" || code === "preferred_channel_mismatch" || code === "marketing_consent_required" || code === "lead_not_contactable") return Response.json({ error: code }, { status: 409 });
    if (["idempotency_conflict", "template_data_unavailable", "draft_body_required"].includes(code)) return Response.json({ error: code === "draft_body_required" ? "invalid_input" : code }, { status: 409 });
    if (code === "template_unavailable") return Response.json({ error: code }, { status: 404 });
    return Response.json({ error: "communication_draft_unavailable" }, { status: 409 });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = cancelDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("leads.activities.write");
  if (access.response) return access.response;
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const [lead] = await tx.select().from(leads)
        .where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).for("update").limit(1);
      if (!lead || !hasLeadCentrePermission(access.staff.grants, "leads.activities.write", lead.centreId)) throw new Error("lead_unavailable");
      const [draft] = await tx.select().from(leadCommunicationDrafts)
        .where(and(eq(leadCommunicationDrafts.id, parsed.data.draftId), eq(leadCommunicationDrafts.leadId, lead.id), eq(leadCommunicationDrafts.organizationId, lead.organizationId), eq(leadCommunicationDrafts.centreId, lead.centreId))).for("update").limit(1);
      if (!draft) throw new Error("draft_unavailable");
      if (draft.status === "CANCELLED") return { id: draft.id, status: draft.status, replayed: true };
      if (draft.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) throw new Error("draft_conflict");
      const [updated] = await tx.update(leadCommunicationDrafts)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        // The row lock above serializes concurrent cancellation. The client
        // version was checked against the locked row; avoid comparing a JS
        // millisecond Date against PostgreSQL's potentially microsecond value.
        .where(and(eq(leadCommunicationDrafts.id, draft.id), eq(leadCommunicationDrafts.status, "DRAFT")))
        .returning({ id: leadCommunicationDrafts.id, status: leadCommunicationDrafts.status });
      if (!updated) throw new Error("draft_conflict");
      await tx.insert(leadCommunicationDraftEvents).values({ organizationId: lead.organizationId, centreId: lead.centreId, draftId: draft.id, actorStaffId: access.staff.staffUserId, eventType: "CANCELLED" });
      await appendAuditEvent(tx, { organizationId: lead.organizationId, centreId: lead.centreId, actorStaffId: access.staff.staffUserId, action: "lead.communication_draft_cancelled", entityType: "lead", entityId: lead.id, details: { draftId: draft.id, status: "CANCELLED" } });
      return { ...updated, replayed: false };
    });
    return Response.json({ draft: result }, { status: 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "draft_conflict") return Response.json({ error: code }, { status: 409 });
    return Response.json({ error: "draft_unavailable" }, { status: 404 });
  }
}
