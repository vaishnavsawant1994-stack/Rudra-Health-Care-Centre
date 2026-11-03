import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appointments, leadConversions, leads, marketingCampaignEvents, marketingCampaigns } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { hasPermission } from "@/server/permissions";
import { campaignCreateSchema } from "@/server/marketing-campaign-policy";
import { parseAnalyticsDate } from "@/server/lead-analytics";

const listSchema = z.object({ centreId: z.uuid(), status: z.enum(["ALL", "DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"]).default("ALL"), from: z.string().optional(), to: z.string().optional() }).strict();
type PrivateData = { name: string; description: string | null };
const ctx = (org: string, centre: string, id: string) => operationalContext({ organizationId: org, centreId: centre, recordId: id }, "marketing-campaign");
const reveal = (row: typeof marketingCampaigns.$inferSelect) => ({ id: row.id, centreId: row.centreId, campaignCode: row.campaignCode, channel: row.channel, status: row.status, startsOn: row.startsOn, endsOn: row.endsOn, versionNumber: row.versionNumber, ...decryptOperationalData<PrivateData>(row.privateDataCiphertext, ctx(row.organizationId, row.centreId, row.id)), createdAt: row.createdAt, updatedAt: row.updatedAt });
const scopePermission = (grants: Array<{ key: string; centreId: string | null }>, key: "marketing.read" | "marketing.manage", centre: string) => hasPermission(grants, key, centre);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  if ((fromRaw === null) !== (toRaw === null)) return Response.json({ error: "invalid_date_range" }, { status: 400 });
  const from = fromRaw === null ? null : parseAnalyticsDate(fromRaw);
  const toDate = toRaw === null ? null : parseAnalyticsDate(toRaw);
  if ((fromRaw !== null && !from) || (toRaw !== null && !toDate) || (from && toDate && from > toDate)) return Response.json({ error: "invalid_date_range" }, { status: 400 });
  const end = toDate ? new Date(toDate.getTime() + 86_400_000) : null;
  if (from && end && end.getTime() - from.getTime() > 366 * 86_400_000) return Response.json({ error: "date_range_too_large" }, { status: 400 });
  const { centreId, status } = parsed.data;
  const access = await getApiAccess("marketing.read", centreId);
  if (access.response) return access.response;
  if (!access.staff) return Response.json({ error: "authentication_required" }, { status: 401 });
  if (!scopePermission(access.staff.grants, "marketing.read", centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const rows = await getDb().select().from(marketingCampaigns).where(and(eq(marketingCampaigns.organizationId, access.staff.organizationId), eq(marketingCampaigns.centreId, centreId), status === "ALL" ? undefined : eq(marketingCampaigns.status, status))).orderBy(desc(marketingCampaigns.updatedAt), desc(marketingCampaigns.id)).limit(100);
  // The date window is a lead-acquisition cohort. Conversions count whenever
  // that attributed lead was converted, even if the conversion happened later.
  const cohortDateFilter = from && end ? and(gte(leads.createdAt, from), lt(leads.createdAt, end)) : undefined;
  const leadCounts = await getDb().select({ campaignId: leads.marketingCampaignId, count: count() }).from(leads).where(and(eq(leads.organizationId, access.staff.organizationId), eq(leads.centreId, centreId), isNotNull(leads.marketingCampaignId), cohortDateFilter)).groupBy(leads.marketingCampaignId);
  const countByCampaign = new Map(leadCounts.filter((row) => row.campaignId).map((row) => [row.campaignId!, row.count]));
  const conversionCounts = await getDb().select({ campaignId: leads.marketingCampaignId, count: count() }).from(leadConversions)
    .innerJoin(leads, and(eq(leadConversions.leadId, leads.id), eq(leadConversions.organizationId, leads.organizationId), eq(leadConversions.centreId, leads.centreId)))
    .where(and(eq(leadConversions.organizationId, access.staff.organizationId), eq(leadConversions.centreId, centreId), eq(leads.organizationId, access.staff.organizationId), eq(leads.centreId, centreId), isNotNull(leads.marketingCampaignId), cohortDateFilter))
    .groupBy(leads.marketingCampaignId);
  const convertedByCampaign = new Map(conversionCounts.filter((row) => row.campaignId).map((row) => [row.campaignId!, row.count]));
  const appointmentCounts = await getDb().select({
    campaignId: leads.marketingCampaignId,
    appointmentCount: count(),
    activeAppointmentCount: count(sql`CASE WHEN ${appointments.status} NOT IN ('CANCELLED', 'NO_SHOW') THEN 1 END`),
    confirmedAppointmentCount: count(sql`CASE WHEN ${appointments.status} IN ('CONFIRMED', 'ASSIGNED', 'RESCHEDULED') THEN 1 END`),
  }).from(appointments)
    .innerJoin(leads, and(eq(appointments.leadId, leads.id), eq(appointments.organizationId, leads.organizationId), eq(appointments.centreId, leads.centreId)))
    .where(and(eq(appointments.organizationId, access.staff.organizationId), eq(appointments.centreId, centreId), eq(leads.organizationId, access.staff.organizationId), eq(leads.centreId, centreId), isNotNull(leads.marketingCampaignId), cohortDateFilter))
    .groupBy(leads.marketingCampaignId);
  const appointmentCountsByCampaign = new Map(appointmentCounts.filter((row) => row.campaignId).map((row) => [row.campaignId!, row]));
  return Response.json({ attributionWindow: from && toDate ? { from: from.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10), basis: "LEAD_CREATED_COHORT" } : { from: null, to: null, basis: "ALL_RECORDED_LEADS" }, campaigns: rows.map((row) => {
    const attributedLeadCount = countByCampaign.get(row.id) ?? 0;
    const convertedLeadCount = convertedByCampaign.get(row.id) ?? 0;
    const appointmentMetrics = appointmentCountsByCampaign.get(row.id);
    return { ...reveal(row), attributedLeadCount, convertedLeadCount, conversionRatePercent: attributedLeadCount === 0 ? null : Math.round((convertedLeadCount / attributedLeadCount) * 1000) / 10, appointmentCount: appointmentMetrics?.appointmentCount ?? 0, activeAppointmentCount: appointmentMetrics?.activeAppointmentCount ?? 0, confirmedAppointmentCount: appointmentMetrics?.confirmedAppointmentCount ?? 0 };
  }), actions: { publishing: "DISABLED", messaging: "DISABLED", advertisingSpend: "DISABLED" } }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = campaignCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_campaign", issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
  const data = parsed.data;
  const access = await getApiAccess("marketing.manage", data.centreId);
  if (access.response) return access.response;
  if (!access.staff) return Response.json({ error: "authentication_required" }, { status: 401 });
  if (!scopePermission(access.staff.grants, "marketing.manage", data.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const requestHash = createHash("sha256").update(JSON.stringify({ campaignCode: data.campaignCode, channel: data.channel, startsOn: data.startsOn ?? null, endsOn: data.endsOn ?? null })).digest("hex");
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:marketing-campaign:${data.idempotencyKey}`}, 0))`);
      const [existing] = await tx.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.organizationId, access.staff.organizationId), eq(marketingCampaigns.idempotencyKey, data.idempotencyKey))).limit(1);
      if (existing) {
        const prior = decryptOperationalData<PrivateData>(existing.privateDataCiphertext, ctx(existing.organizationId, existing.centreId, existing.id));
        const same = existing.requestHash === requestHash && existing.centreId === data.centreId && prior.name === data.name && (prior.description ?? null) === (data.description ?? null) && existing.createdByStaffId === access.staff.staffUserId;
        if (!same) throw new Error("idempotency_conflict");
        return { row: existing, replayed: true };
      }
      const id = randomUUID();
      const [row] = await tx.insert(marketingCampaigns).values({ id, organizationId: access.staff.organizationId, centreId: data.centreId, campaignCode: data.campaignCode, channel: data.channel, status: "DRAFT", startsOn: data.startsOn ?? null, endsOn: data.endsOn ?? null, privateDataCiphertext: encryptOperationalData({ name: data.name, description: data.description ?? null }, ctx(access.staff.organizationId, data.centreId, id)), createdByStaffId: access.staff.staffUserId, updatedByStaffId: access.staff.staffUserId, idempotencyKey: data.idempotencyKey, requestHash }).returning();
      const eventId = randomUUID();
      await tx.insert(marketingCampaignEvents).values({ id: eventId, organizationId: access.staff.organizationId, centreId: data.centreId, campaignId: id, actorStaffId: access.staff.staffUserId, eventType: "CREATED", privateDataCiphertext: encryptOperationalData({ campaignCode: data.campaignCode, channel: data.channel, status: "DRAFT", name: data.name }, operationalContext({ organizationId: access.staff.organizationId, centreId: data.centreId, recordId: eventId }, "marketing-campaign-event")), idempotencyKey: data.idempotencyKey, requestHash });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: data.centreId, actorStaffId: access.staff.staffUserId, action: "marketing.campaign_created", entityType: "marketing_campaign", entityId: id, details: { channel: data.channel, status: "DRAFT" } });
      return { row, replayed: false };
    });
    return Response.json({ campaign: reveal(result.row), replayed: result.replayed, actions: { publishing: "DISABLED", messaging: "DISABLED", advertisingSpend: "DISABLED" } }, { status: result.replayed ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "idempotency_conflict" ? "idempotency_conflict" : "campaign_unavailable" }, { status: 409 });
  }
}
