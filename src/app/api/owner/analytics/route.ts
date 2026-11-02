import { and, count, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { appointments, centres, collectionJobs, diagnosticOrders, dispatchBatches, leadConversions, leads, patients, publicEnquiries, sampleExceptions, specimens, staffEscalations, staffTasks } from "@/db/schema";
import { getApiAccess } from "@/server/access";
import { hasPermission } from "@/server/permissions";
import { ownerAnalyticsBounds, ownerAnalyticsFilterSchema } from "@/server/owner-analytics-policy";

type MetricKey = "websiteEnquiriesCreated" | "leadsCreated" | "leadsConverted" | "patientsRegistered" | "appointmentsCreated" | "ordersCreated" | "collectionsCreated" | "reportsRegistered";
type QueueMetricKey = "appointmentsAwaitingConfirmation" | "tasksAwaitingAction" | "openEscalations" | "reportsPendingVerification" | "reportFollowupsDue" | "specimensAwaitingReceiving" | "specimensAwaitingDispatch" | "dispatchBatchesPreparing" | "dispatchBatchesAwaitingReceipt" | "sampleExceptionsOpen";
const metricRules: Array<{ key: MetricKey; permission: string; query: (organizationId: string, centreId: string, start: Date, end: Date) => Promise<number> }> = [
  { key: "websiteEnquiriesCreated", permission: "leads.read", query: async (organizationId, centreId, start, end) => (await getDb().select({ value: count() }).from(publicEnquiries).where(and(eq(publicEnquiries.organizationId, organizationId), eq(publicEnquiries.centreId, centreId), gte(publicEnquiries.createdAt, start), lt(publicEnquiries.createdAt, end))))[0]?.value ?? 0 },
  { key: "leadsCreated", permission: "leads.read", query: async (organizationId, centreId, start, end) => (await getDb().select({ value: count() }).from(leads).where(and(eq(leads.organizationId, organizationId), eq(leads.centreId, centreId), gte(leads.createdAt, start), lt(leads.createdAt, end))))[0]?.value ?? 0 },
  { key: "leadsConverted", permission: "leads.read", query: async (organizationId, centreId, start, end) => (await getDb().select({ value: count() }).from(leadConversions).where(and(eq(leadConversions.organizationId, organizationId), eq(leadConversions.centreId, centreId), gte(leadConversions.convertedAt, start), lt(leadConversions.convertedAt, end))))[0]?.value ?? 0 },
  { key: "patientsRegistered", permission: "patients.read", query: async (organizationId, centreId, start, end) => (await getDb().select({ value: count() }).from(patients).where(and(eq(patients.organizationId, organizationId), eq(patients.centreId, centreId), gte(patients.createdAt, start), lt(patients.createdAt, end))))[0]?.value ?? 0 },
  { key: "appointmentsCreated", permission: "appointments.read", query: async (organizationId, centreId, start, end) => (await getDb().select({ value: count() }).from(appointments).where(and(eq(appointments.organizationId, organizationId), eq(appointments.centreId, centreId), gte(appointments.createdAt, start), lt(appointments.createdAt, end))))[0]?.value ?? 0 },
  { key: "ordersCreated", permission: "orders.read", query: async (organizationId, centreId, start, end) => (await getDb().select({ value: count() }).from(diagnosticOrders).where(and(eq(diagnosticOrders.organizationId, organizationId), eq(diagnosticOrders.centreId, centreId), gte(diagnosticOrders.createdAt, start), lt(diagnosticOrders.createdAt, end))))[0]?.value ?? 0 },
  { key: "collectionsCreated", permission: "collections.read", query: async (organizationId, centreId, start, end) => (await getDb().select({ value: count() }).from(collectionJobs).where(and(eq(collectionJobs.organizationId, organizationId), eq(collectionJobs.centreId, centreId), gte(collectionJobs.createdAt, start), lt(collectionJobs.createdAt, end))))[0]?.value ?? 0 },
  { key: "reportsRegistered", permission: "reports.read", query: async (organizationId, centreId, start, end) => { const result = await getDb().execute(sql`SELECT count(*)::int AS value FROM diagnostic_reports WHERE organization_id=${organizationId} AND centre_id=${centreId} AND created_at >= ${start} AND created_at < ${end}`); return Number((result as unknown as { rows: Array<{ value: number }> }).rows[0]?.value ?? 0); } },
];
const queueMetricRules: Array<{ key: QueueMetricKey; permission: string; query: (organizationId: string, centreId: string, now: Date) => Promise<number> }> = [
  { key: "appointmentsAwaitingConfirmation", permission: "appointments.read", query: async (organizationId, centreId) => (await getDb().select({ value: count() }).from(appointments).where(and(eq(appointments.organizationId, organizationId), eq(appointments.centreId, centreId), eq(appointments.status, "REQUESTED"))))[0]?.value ?? 0 },
  { key: "tasksAwaitingAction", permission: "tasks.read", query: async (organizationId, centreId) => (await getDb().select({ value: count() }).from(staffTasks).where(and(eq(staffTasks.organizationId, organizationId), eq(staffTasks.centreId, centreId), inArray(staffTasks.status, ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"]))))[0]?.value ?? 0 },
  { key: "openEscalations", permission: "escalations.read", query: async (organizationId, centreId) => (await getDb().select({ value: count() }).from(staffEscalations).where(and(eq(staffEscalations.organizationId, organizationId), eq(staffEscalations.centreId, centreId), inArray(staffEscalations.status, ["OPEN", "ACKNOWLEDGED"]))))[0]?.value ?? 0 },
  { key: "reportsPendingVerification", permission: "reports.read", query: async (organizationId, centreId) => { const result = await getDb().execute(sql`SELECT count(*)::int AS value FROM diagnostic_reports WHERE organization_id=${organizationId} AND centre_id=${centreId} AND status IN ('QUARANTINED','PENDING_VERIFICATION','ON_HOLD','EXCEPTION')`); return Number((result as unknown as { rows: Array<{ value: number }> }).rows[0]?.value ?? 0); } },
  { key: "reportFollowupsDue", permission: "reports.followups.manage", query: async (organizationId, centreId, now) => { const result = await getDb().execute(sql`SELECT count(*)::int AS value FROM report_followups WHERE organization_id=${organizationId} AND centre_id=${centreId} AND status='SCHEDULED' AND due_at <= ${now}`); return Number((result as unknown as { rows: Array<{ value: number }> }).rows[0]?.value ?? 0); } },
  { key: "specimensAwaitingReceiving", permission: "samples.receive", query: async (organizationId, centreId) => (await getDb().select({ value: count() }).from(specimens).where(and(eq(specimens.organizationId, organizationId), eq(specimens.centreId, centreId), eq(specimens.status, "COLLECTED"))))[0]?.value ?? 0 },
  { key: "specimensAwaitingDispatch", permission: "samples.dispatch", query: async (organizationId, centreId) => (await getDb().select({ value: count() }).from(specimens).where(and(eq(specimens.organizationId, organizationId), eq(specimens.centreId, centreId), eq(specimens.status, "RECEIVED_AT_RUDRA"), isNull(specimens.dispatchBatchId))))[0]?.value ?? 0 },
  { key: "dispatchBatchesPreparing", permission: "samples.dispatch", query: async (organizationId, centreId) => (await getDb().select({ value: count() }).from(dispatchBatches).where(and(eq(dispatchBatches.organizationId, organizationId), eq(dispatchBatches.centreId, centreId), eq(dispatchBatches.status, "PREPARING"))))[0]?.value ?? 0 },
  { key: "dispatchBatchesAwaitingReceipt", permission: "samples.dispatch", query: async (organizationId, centreId) => (await getDb().select({ value: count() }).from(dispatchBatches).where(and(eq(dispatchBatches.organizationId, organizationId), eq(dispatchBatches.centreId, centreId), eq(dispatchBatches.status, "DISPATCHED"))))[0]?.value ?? 0 },
  { key: "sampleExceptionsOpen", permission: "samples.exceptions.manage", query: async (organizationId, centreId) => (await getDb().select({ value: count() }).from(sampleExceptions).where(and(eq(sampleExceptions.organizationId, organizationId), eq(sampleExceptions.centreId, centreId), inArray(sampleExceptions.status, ["OPEN", "RECOLLECTION_REQUESTED"]))))[0]?.value ?? 0 },
];

export async function GET(request: Request) {
  const parsed = ownerAnalyticsFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const access = await getApiAccess("organization.read", parsed.data.centreId);
  if (access.response) return access.response;
  if (!access.staff) return Response.json({ error: "not_found" }, { status: 404 });
  const visible = await getDb().select({ id: centres.id, code: centres.code, name: centres.name }).from(centres)
    .where(and(eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"), parsed.data.centreId ? eq(centres.id, parsed.data.centreId) : undefined));
  const { start, end } = ownerAnalyticsBounds(parsed.data.from, parsed.data.to);
  const now = new Date();
  const rows = await Promise.all(visible.map(async (centre) => {
    const allowed = metricRules.filter((rule) => hasPermission(access.staff.grants, rule.permission, centre.id));
    const allowedQueues = queueMetricRules.filter((rule) => hasPermission(access.staff.grants, rule.permission, centre.id));
    if (!allowed.length && !allowedQueues.length) return null;
    const values = await Promise.all(allowed.map((rule) => rule.query(access.staff.organizationId, centre.id, start, end)));
    const metrics = Object.fromEntries(allowed.map((rule, index) => [rule.key, values[index]]));
    const queueValues = await Promise.all(allowedQueues.map((rule) => rule.query(access.staff.organizationId, centre.id, now)));
    const currentQueues = Object.fromEntries(allowedQueues.map((rule, index) => [rule.key, queueValues[index]]));
    return { id: centre.id, code: centre.code, name: centre.name, metrics, currentQueues };
  }));
  return Response.json({ range: { from: parsed.data.from, to: parsed.data.to, timeBasis: "UTC calendar dates of the relevant record or conversion event" }, centres: rows.filter((row) => row !== null), metricMeaning: "Creation and conversion event counts for the selected date range. Current queue counts are point-in-time actionable records and do not imply completed services, laboratory processing, report delivery, or revenue." }, { headers: { "cache-control": "private, no-store" } });
}
