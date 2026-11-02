import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { marketingContentEvents, marketingContentItems } from "@/db/schema";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { hasPermission } from "@/server/permissions";
import { marketingContentActionSchema, type MarketingContentAction } from "@/server/marketing-content-policy";

const paramsSchema = z.object({ id: z.uuid() });
const ctx = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "marketing-content");
const eventCtx = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "marketing-content-event");
type PrivateData = { title: string; body: string; internalNote: string | null };
const reveal = (row: typeof marketingContentItems.$inferSelect) => ({ id: row.id, centreId: row.centreId, campaignId: row.campaignId, channel: row.channel, contentType: row.contentType, status: row.status, plannedPublishAt: row.plannedPublishAt, versionNumber: row.versionNumber, createdByStaffId: row.createdByStaffId, reviewedByStaffId: row.reviewedByStaffId, ...decryptOperationalData<PrivateData>(row.privateDataCiphertext, ctx(row.organizationId, row.centreId, row.id)), createdAt: row.createdAt, updatedAt: row.updatedAt });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!paramsSchema.safeParse({ id }).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("marketing.read");
  if (access.response) return access.response;
  if (!access.staff) return Response.json({ error: "not_found" }, { status: 404 });
  const [row] = await getDb().select().from(marketingContentItems).where(and(eq(marketingContentItems.id, id), eq(marketingContentItems.organizationId, access.staff.organizationId))).limit(1);
  if (!row || !hasPermission(access.staff.grants, "marketing.read", row.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const events = await getDb().select().from(marketingContentEvents).where(and(eq(marketingContentEvents.organizationId, row.organizationId), eq(marketingContentEvents.centreId, row.centreId), eq(marketingContentEvents.contentItemId, row.id))).orderBy(desc(marketingContentEvents.recordedAt), desc(marketingContentEvents.id)).limit(100);
    return Response.json({ item: reveal(row), history: events.map((event) => ({ id: event.id, eventType: event.eventType, recordedAt: event.recordedAt, ...decryptOperationalData<{ status?: string; reason?: string; versionNumber?: number }>(event.privateDataCiphertext, eventCtx(event.organizationId, event.centreId, event.id)) })), externalPublishing: "DISABLED" }, { headers: { "cache-control": "private, no-store" } });
  } catch { return Response.json({ error: "content_unavailable" }, { status: 503 }); }
}

function transition(action: MarketingContentAction, status: string, creatorId: string, actorId: string) {
  if (action.action === "UPDATE") {
    if (status !== "DRAFT") throw new Error("invalid_transition");
    return { status: "DRAFT", eventType: "UPDATED" as const };
  }
  if (action.action === "SUBMIT_REVIEW") {
    if (status !== "DRAFT") throw new Error("invalid_transition");
    return { status: "IN_REVIEW", eventType: "SUBMITTED" as const };
  }
  if (action.action === "APPROVE" || action.action === "REQUEST_CHANGES") {
    if (status !== "IN_REVIEW") throw new Error("invalid_transition");
    if (creatorId === actorId) throw new Error("independent_review_required");
    return action.action === "APPROVE" ? { status: "APPROVED", eventType: "APPROVED" as const } : { status: "DRAFT", eventType: "CHANGES_REQUESTED" as const };
  }
  if (action.action === "SCHEDULE") {
    if (status !== "APPROVED") throw new Error("invalid_transition");
    if (new Date(action.plannedPublishAt).getTime() <= Date.now()) throw new Error("schedule_must_be_future");
    return { status: "SCHEDULED", eventType: "SCHEDULED" as const };
  }
  if (["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED"].includes(status)) return { status: "CANCELLED", eventType: "CANCELLED" as const };
  throw new Error("invalid_transition");
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!paramsSchema.safeParse({ id }).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = marketingContentActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_content_action" }, { status: 400 });
  const key = request.headers.get("idempotency-key");
  if (!z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const access = await getApiAccess("marketing.manage");
  if (access.response) return access.response;
  if (!access.staff) return Response.json({ error: "not_found" }, { status: 404 });
  const action = parsed.data;
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:marketing-content-record:${id}`},0))`);
      const [current] = await tx.select().from(marketingContentItems).where(and(eq(marketingContentItems.id, id), eq(marketingContentItems.organizationId, access.staff.organizationId))).for("update").limit(1);
      if (!current || !hasPermission(access.staff.grants, "marketing.manage", current.centreId)) throw new Error("not_found");
      const fingerprintContext = operationalContext({ organizationId: current.organizationId, centreId: current.centreId, recordId: `${id}:${key}` }, "marketing-content-action-idempotency");
      const fingerprint = fingerprintOperationalRequest(action, fingerprintContext);
      const [prior] = await tx.select().from(marketingContentEvents).where(and(eq(marketingContentEvents.organizationId, current.organizationId), eq(marketingContentEvents.idempotencyKey, key!))).limit(1);
      if (prior) {
        if (prior.contentItemId !== current.id || prior.actorStaffId !== access.staff.staffUserId || !verifyOperationalRequestFingerprint(action, prior.requestFingerprint, fingerprintContext)) throw new Error("idempotency_conflict");
        const snapshot = decryptOperationalData<{ status: string; versionNumber: number }>(prior.privateDataCiphertext, eventCtx(prior.organizationId, prior.centreId, prior.id));
        return { item: current, replayed: true, outcome: snapshot };
      }
      if (current.versionNumber !== action.expectedVersion) throw new Error("version_conflict");
      const next = transition(action, current.status, current.createdByStaffId, access.staff.staffUserId);
      const privateData = decryptOperationalData<PrivateData>(current.privateDataCiphertext, ctx(current.organizationId, current.centreId, current.id));
      const update = action.action === "UPDATE" ? { channel: action.channel ?? current.channel, contentType: action.contentType ?? current.contentType, campaignId: action.campaignId === undefined ? current.campaignId : action.campaignId, privateDataCiphertext: encryptOperationalData({ title: action.title, body: action.body, internalNote: action.internalNote === undefined ? privateData.internalNote : action.internalNote }, ctx(current.organizationId, current.centreId, current.id)) } : {};
      const reviewedByStaffId = action.action === "APPROVE" ? access.staff.staffUserId : action.action === "REQUEST_CHANGES" ? null : current.reviewedByStaffId;
      const plannedPublishAt = action.action === "SCHEDULE" ? new Date(action.plannedPublishAt) : action.action === "CANCEL" ? null : current.plannedPublishAt;
      const [updated] = await tx.update(marketingContentItems).set({ ...update, ...next, reviewedByStaffId, plannedPublishAt, updatedByStaffId: access.staff.staffUserId, versionNumber: current.versionNumber + 1, updatedAt: new Date() }).where(and(eq(marketingContentItems.id, id), eq(marketingContentItems.versionNumber, action.expectedVersion))).returning();
      if (!updated) throw new Error("version_conflict");
      const eventId = randomUUID();
      const reason = action.action === "UPDATE" ? action.reason : "reason" in action ? action.reason : null;
      const snapshot = { status: updated.status, versionNumber: updated.versionNumber, reason, title: action.action === "UPDATE" ? action.title : privateData.title };
      await tx.insert(marketingContentEvents).values({ id: eventId, organizationId: current.organizationId, centreId: current.centreId, contentItemId: id, actorStaffId: access.staff.staffUserId, eventType: next.eventType, privateDataCiphertext: encryptOperationalData(snapshot, eventCtx(current.organizationId, current.centreId, eventId)), idempotencyKey: key!, requestFingerprint: fingerprint });
      await appendAuditEvent(tx, { organizationId: current.organizationId, centreId: current.centreId, actorStaffId: access.staff.staffUserId, action: `marketing.content_${updated.status.toLowerCase()}`, entityType: "marketing_content_item", entityId: id, details: { status: updated.status, versionNumber: updated.versionNumber, eventType: next.eventType } });
      return { item: updated, replayed: false, outcome: { status: updated.status, versionNumber: updated.versionNumber } };
    });
    return Response.json({ item: reveal(result.item), replayed: result.replayed, externalPublishing: "DISABLED" }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "not_found" ? 404 : code === "invalid_transition" || code === "independent_review_required" || code === "schedule_must_be_future" ? 409 : code === "version_conflict" || code === "idempotency_conflict" ? 409 : 503;
    return Response.json({ error: ["not_found", "invalid_transition", "independent_review_required", "schedule_must_be_future", "version_conflict", "idempotency_conflict"].includes(code) ? code : "content_unavailable" }, { status });
  }
}
