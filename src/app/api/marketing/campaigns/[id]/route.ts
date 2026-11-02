import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { marketingCampaignEvents, marketingCampaigns } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { hasPermission } from "@/server/permissions";
import { campaignStatusSchema, campaignUpdateSchema } from "@/server/marketing-campaign-policy";

const paramsSchema = z.object({ id: z.uuid() });
type PrivateData = { name: string; description: string | null };
const ctx = (org: string, centre: string, id: string) => operationalContext({ organizationId: org, centreId: centre, recordId: id }, "marketing-campaign");
const reveal = (row: typeof marketingCampaigns.$inferSelect) => ({ id: row.id, centreId: row.centreId, campaignCode: row.campaignCode, channel: row.channel, status: row.status, startsOn: row.startsOn, endsOn: row.endsOn, versionNumber: row.versionNumber, ...decryptOperationalData<PrivateData>(row.privateDataCiphertext, ctx(row.organizationId, row.centreId, row.id)), createdAt: row.createdAt, updatedAt: row.updatedAt });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!paramsSchema.safeParse({ id }).success) return Response.json({ error: "not_found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = campaignUpdateSchema.safeParse(body);
  const parsedStatus = parsed.success ? null : campaignStatusSchema.safeParse(body);
  if (!parsed.success && !parsedStatus?.success) return Response.json({ error: "invalid_campaign_action" }, { status: 400 });
  const access = await getApiAccess("marketing.manage");
  if (access.response) return access.response;
  if (!access.staff) return Response.json({ error: "authentication_required" }, { status: 401 });
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:marketing-campaign-record:${id}`}, 0))`);
      const [current] = await tx.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.organizationId, access.staff.organizationId))).limit(1);
      if (!current || !hasPermission(access.staff.grants, "marketing.manage", current.centreId)) throw new Error("not_found");
      const privateData = decryptOperationalData<PrivateData>(current.privateDataCiphertext, ctx(current.organizationId, current.centreId, current.id));
      let eventType: "UPDATED" | "ACTIVATED" | "COMPLETED" | "CANCELLED";
      let next: typeof current;
      let auditAction: string;
      if (parsed.success) {
        if (current.status === "COMPLETED" || current.status === "CANCELLED") throw new Error("campaign_closed");
        const startsOn = parsed.data.startsOn === undefined ? current.startsOn : parsed.data.startsOn;
        const endsOn = parsed.data.endsOn === undefined ? current.endsOn : parsed.data.endsOn;
        if (startsOn && endsOn && endsOn < startsOn) throw new Error("invalid_dates");
        const [updated] = await tx.update(marketingCampaigns).set({ campaignCode: parsed.data.campaignCode ?? current.campaignCode, channel: parsed.data.channel ?? current.channel, startsOn, endsOn, privateDataCiphertext: encryptOperationalData({ name: parsed.data.name ?? privateData.name, description: parsed.data.description === undefined ? privateData.description : parsed.data.description }, ctx(current.organizationId, current.centreId, id)), updatedByStaffId: access.staff.staffUserId, versionNumber: current.versionNumber + 1, updatedAt: new Date() }).where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.versionNumber, parsed.data.expectedVersion))).returning();
        if (!updated) throw new Error("version_conflict");
        next = updated; eventType = "UPDATED"; auditAction = "marketing.campaign_updated";
      } else {
        const statusData = parsedStatus?.success ? parsedStatus.data : null;
        if (!statusData) throw new Error("invalid_campaign_action");
        const action = statusData.action;
        const allowed = action === "ACTIVATE" ? current.status === "DRAFT" : action === "COMPLETE" ? current.status === "ACTIVE" : current.status === "DRAFT" || current.status === "ACTIVE";
        if (!allowed) throw new Error("invalid_transition");
        const status = action === "ACTIVATE" ? "ACTIVE" : action === "COMPLETE" ? "COMPLETED" : "CANCELLED";
        const [updated] = await tx.update(marketingCampaigns).set({ status, updatedByStaffId: access.staff.staffUserId, versionNumber: current.versionNumber + 1, updatedAt: new Date() }).where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.versionNumber, statusData.expectedVersion))).returning();
        if (!updated) throw new Error("version_conflict");
        next = updated; eventType = action === "ACTIVATE" ? "ACTIVATED" : action === "COMPLETE" ? "COMPLETED" : "CANCELLED"; auditAction = `marketing.campaign_${status.toLowerCase()}`;
      }
      const eventId = randomUUID();
      const historyPrivate = decryptOperationalData<PrivateData>(next.privateDataCiphertext, ctx(next.organizationId, next.centreId, next.id));
      const eventRequestId = randomUUID();
      await tx.insert(marketingCampaignEvents).values({ id: eventId, organizationId: current.organizationId, centreId: current.centreId, campaignId: id, actorStaffId: access.staff.staffUserId, eventType, privateDataCiphertext: encryptOperationalData({ campaignCode: next.campaignCode, channel: next.channel, name: historyPrivate.name, description: historyPrivate.description, status: next.status, reason: parsedStatus?.success ? parsedStatus.data.reason : parsed.success ? parsed.data.reason : undefined, versionNumber: next.versionNumber }, operationalContext({ organizationId: current.organizationId, centreId: current.centreId, recordId: eventId }, "marketing-campaign-event")), idempotencyKey: eventRequestId, requestHash: createHash("sha256").update(eventRequestId).digest("hex") });
      await appendAuditEvent(tx, { organizationId: current.organizationId, centreId: current.centreId, actorStaffId: access.staff.staffUserId, action: auditAction, entityType: "marketing_campaign", entityId: id, details: { status: next.status, versionNumber: next.versionNumber } });
      return next;
    });
    return Response.json({ campaign: reveal(result), actions: { publishing: "DISABLED", messaging: "DISABLED", advertisingSpend: "DISABLED" } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "not_found" ? 404 : code === "version_conflict" ? 409 : 422;
    return Response.json({ error: ["not_found", "version_conflict", "invalid_dates", "campaign_closed", "invalid_transition"].includes(code) ? code : "campaign_unavailable" }, { status });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!paramsSchema.safeParse({ id }).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("marketing.read");
  if (access.response) return access.response;
  if (!access.staff) return Response.json({ error: "authentication_required" }, { status: 401 });
  const [campaign] = await getDb().select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.organizationId, access.staff.organizationId))).limit(1);
  if (!campaign || !hasPermission(access.staff.grants, "marketing.read", campaign.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const events = await getDb().select().from(marketingCampaignEvents).where(and(eq(marketingCampaignEvents.organizationId, campaign.organizationId), eq(marketingCampaignEvents.campaignId, campaign.id), eq(marketingCampaignEvents.centreId, campaign.centreId))).orderBy(desc(marketingCampaignEvents.recordedAt), desc(marketingCampaignEvents.id)).limit(100);
  return Response.json({ campaign: reveal(campaign), history: events.map((event) => ({ id: event.id, eventType: event.eventType, recordedAt: event.recordedAt, ...decryptOperationalData<{ status?: string; reason?: string; versionNumber?: number }>(event.privateDataCiphertext, operationalContext({ organizationId: event.organizationId, centreId: event.centreId, recordId: event.id }, "marketing-campaign-event")) })) }, { headers: { "cache-control": "private, no-store" } });
}
