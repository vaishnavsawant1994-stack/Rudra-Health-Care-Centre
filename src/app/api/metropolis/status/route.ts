import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { diagnosticOrders, metropolisReferenceMappings, metropolisStatusEvents, metropolisStatusReviews, specimens } from "@/db/schema";
import { blindIndexMetropolisReference } from "@/server/metropolis-crypto";
import { canReviewMetropolisStatus, metropolisStatusActionSchema } from "@/server/metropolis-policy";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const id = z.uuid();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const centreId = params.get("centreId") ?? undefined;
  const orderId = params.get("orderId") ?? undefined;
  if (centreId && !id.safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  if (orderId && !id.safeParse(orderId).success) return Response.json({ error: "invalid_order" }, { status: 400 });
  const access = await getApiAccess("samples.read", centreId);
  if (access.response) return access.response;
  const scopes = access.staff.grants.filter((grant) => grant.key === "samples.read").map((grant) => grant.centreId);
  const where = [eq(metropolisStatusEvents.organizationId, access.staff.organizationId)];
  if (centreId) where.push(eq(metropolisStatusEvents.centreId, centreId));
  if (orderId) where.push(eq(metropolisStatusEvents.orderId, orderId));
  if (!scopes.includes(null)) where.push(scopes.length ? inArray(metropolisStatusEvents.centreId, scopes.filter((scope): scope is string => scope !== null)) : eq(metropolisStatusEvents.centreId, "00000000-0000-0000-0000-000000000000"));
  const rows = await getDb().select().from(metropolisStatusEvents).where(and(...where)).orderBy(asc(metropolisStatusEvents.recordedAt)).limit(500);
  const reviews = rows.length ? await getDb().select().from(metropolisStatusReviews).where(and(eq(metropolisStatusReviews.organizationId, access.staff.organizationId), inArray(metropolisStatusReviews.statusEventId, rows.map((row) => row.id)))) : [];
  const reviewByEvent = new Map(reviews.map((review) => [review.statusEventId, review]));
  const events = rows.map((row) => {
    const { id, organizationId, centreId, orderId, specimenId, statusCode, occurredAt, supersedesEventId, actorStaffId, recordedAt } = row;
    const privateData = decryptOperationalData<{ externalReference: string; evidenceReference: string; reason: string }>(row.privateDataCiphertext, operationalContext({ organizationId, centreId, recordId: id }, "metropolis-status-event"));
    const review = reviewByEvent.get(row.id);
    const reviewData = review ? decryptOperationalData<{ evidenceReference: string; reason: string }>(review.privateDataCiphertext, operationalContext({ organizationId: review.organizationId, centreId: review.centreId, recordId: review.id }, "metropolis-status-review")) : null;
    return { id, centreId, orderId, specimenId, statusCode, occurredAt, supersedesEventId, actorStaffId, recordedAt, ...privateData, review: review ? { decision: review.decision, reviewerStaffId: review.reviewerStaffId, reviewedAt: review.reviewedAt, ...reviewData } : null, source: "STAFF_RECORDED" };
  });
  return Response.json({ events }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = metropolisStatusActionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_metropolis_status_action", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const key = request.headers.get("idempotency-key");
  if (!id.safeParse(key).success) return Response.json({ error: "valid_idempotency_key_required" }, { status: 400 });
  const base = await getApiAccess("samples.external.verify");
  if (base.response) return base.response;
  const db = getDb();
  try {
    if (parsed.data.action === "record") {
      const data = parsed.data;
      const [order] = await db.select({ id: diagnosticOrders.id, organizationId: diagnosticOrders.organizationId, centreId: diagnosticOrders.centreId }).from(diagnosticOrders).where(and(eq(diagnosticOrders.id, data.orderId), eq(diagnosticOrders.organizationId, base.staff.organizationId))).limit(1);
      if (!order) return Response.json({ error: "order_not_found" }, { status: 404 });
      const access = await getApiAccess("samples.external.verify", order.centreId);
      if (access.response) return access.response;
      if (data.specimenId) {
        const [specimen] = await db.select({ id: specimens.id }).from(specimens).where(and(eq(specimens.id, data.specimenId), eq(specimens.orderId, order.id), eq(specimens.organizationId, order.organizationId), eq(specimens.centreId, order.centreId))).limit(1);
        if (!specimen) return Response.json({ error: "specimen_not_found" }, { status: 404 });
      }
      const referenceBlindIndex = blindIndexMetropolisReference(data.externalReference);
      const [mapping] = await db.select({ id: metropolisReferenceMappings.id }).from(metropolisReferenceMappings).where(and(eq(metropolisReferenceMappings.organizationId, order.organizationId), eq(metropolisReferenceMappings.orderId, order.id), eq(metropolisReferenceMappings.referenceBlindIndex, referenceBlindIndex))).limit(1);
      if (!mapping) return Response.json({ error: "external_reference_mapping_required" }, { status: 409 });
      if (data.supersedesEventId) {
        const [prior] = await db.select({ id: metropolisStatusEvents.id, specimenId: metropolisStatusEvents.specimenId }).from(metropolisStatusEvents).where(and(eq(metropolisStatusEvents.id, data.supersedesEventId), eq(metropolisStatusEvents.orderId, order.id), eq(metropolisStatusEvents.organizationId, order.organizationId), eq(metropolisStatusEvents.centreId, order.centreId))).limit(1);
        if (!prior || prior.specimenId !== (data.specimenId ?? null)) return Response.json({ error: "invalid_status_correction_target" }, { status: 409 });
        const [alreadyCorrected] = await db.select({ id: metropolisStatusEvents.id }).from(metropolisStatusEvents).where(and(eq(metropolisStatusEvents.organizationId, order.organizationId), eq(metropolisStatusEvents.supersedesEventId, prior.id))).limit(1);
        if (alreadyCorrected) return Response.json({ error: "status_correction_exists" }, { status: 409 });
      }
      const result = await db.transaction(async (tx) => {
        // Serialize retries independently of the target order. A client can retry
        // the same key while concurrent requests are still committing; without
        // this lock the unique constraint wins the race and a valid replay is
        // reported as an opaque write failure.
        const idemLock = `rudra:metropolis-status-idempotency:${order.organizationId}:${key}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${idemLock}, 0))`);
        if (data.supersedesEventId) {
          const correctionLock = `rudra:metropolis-status-correction:${order.organizationId}:${data.supersedesEventId}`;
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${correctionLock}, 0))`);
        }
        const [priorKey] = await tx.select().from(metropolisStatusEvents).where(and(eq(metropolisStatusEvents.organizationId, order.organizationId), eq(metropolisStatusEvents.idempotencyKey, key!))).limit(1);
        if (priorKey) {
          const priorData = decryptOperationalData<{ externalReference: string; evidenceReference: string; reason: string }>(priorKey.privateDataCiphertext, operationalContext({ organizationId: priorKey.organizationId, centreId: priorKey.centreId, recordId: priorKey.id }, "metropolis-status-event"));
          if (priorKey.orderId !== order.id || priorKey.actorStaffId !== access.staff.staffUserId || priorKey.specimenId !== (data.specimenId ?? null) || priorKey.statusCode !== data.statusCode || priorKey.occurredAt.getTime() !== new Date(data.occurredAt).getTime() || priorKey.supersedesEventId !== (data.supersedesEventId ?? null) || priorData.externalReference !== data.externalReference || priorData.evidenceReference !== data.evidenceReference || priorData.reason !== data.reason) throw new Error("idempotency_conflict");
          return { id: priorKey.id, statusCode: priorKey.statusCode, source: "STAFF_RECORDED", replayed: true };
        }
        if (data.supersedesEventId) {
          const [correction] = await tx.select({ id: metropolisStatusEvents.id }).from(metropolisStatusEvents).where(and(eq(metropolisStatusEvents.organizationId, order.organizationId), eq(metropolisStatusEvents.supersedesEventId, data.supersedesEventId))).limit(1);
          if (correction) throw new Error("status_correction_exists");
        }
        const eventId = randomUUID();
        const privateDataCiphertext = encryptOperationalData({ externalReference: data.externalReference, evidenceReference: data.evidenceReference, reason: data.reason }, operationalContext({ organizationId: order.organizationId, centreId: order.centreId, recordId: eventId }, "metropolis-status-event"));
        const [event] = await tx.insert(metropolisStatusEvents).values({ id: eventId, organizationId: order.organizationId, centreId: order.centreId, orderId: order.id, specimenId: data.specimenId ?? null, statusCode: data.statusCode, occurredAt: new Date(data.occurredAt), supersedesEventId: data.supersedesEventId ?? null, privateDataCiphertext, idempotencyKey: key!, actorStaffId: access.staff.staffUserId }).returning({ id: metropolisStatusEvents.id, statusCode: metropolisStatusEvents.statusCode });
        await appendAuditEvent(tx, { organizationId: order.organizationId, centreId: order.centreId, actorStaffId: access.staff.staffUserId, action: data.supersedesEventId ? "metropolis.status_corrected" : "metropolis.status_recorded", entityType: "diagnostic_order", entityId: order.id, details: { statusEventId: eventId, statusCode: data.statusCode, source: "STAFF_RECORDED", supersedesEventId: data.supersedesEventId ?? null } });
        return { ...event, source: "STAFF_RECORDED", replayed: false };
      });
      return Response.json({ event: result }, { status: result.replayed ? 200 : 201, headers: { "cache-control": "private, no-store" } });
    }

    const data = parsed.data;
    const [event] = await db.select().from(metropolisStatusEvents).where(and(eq(metropolisStatusEvents.id, data.statusEventId), eq(metropolisStatusEvents.organizationId, base.staff.organizationId))).limit(1);
    if (!event) return Response.json({ error: "status_event_not_found" }, { status: 404 });
    const access = await getApiAccess("samples.external.verify", event.centreId);
    if (access.response) return access.response;
    if (!canReviewMetropolisStatus(event.actorStaffId, access.staff.staffUserId)) return Response.json({ error: "independent_review_required" }, { status: 409 });
    const review = await db.transaction(async (tx) => {
      const idemLock = `rudra:metropolis-status-review-idempotency:${event.organizationId}:${key}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${idemLock}, 0))`);
      const eventLock = `rudra:metropolis-status-review-event:${event.organizationId}:${event.id}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${eventLock}, 0))`);
      const [existing] = await tx.select().from(metropolisStatusReviews).where(and(eq(metropolisStatusReviews.organizationId, event.organizationId), eq(metropolisStatusReviews.statusEventId, event.id))).limit(1);
      if (existing) {
        const existingData = decryptOperationalData<{ evidenceReference: string; reason: string }>(existing.privateDataCiphertext, operationalContext({ organizationId: existing.organizationId, centreId: existing.centreId, recordId: existing.id }, "metropolis-status-review"));
        if (existing.reviewerStaffId === access.staff.staffUserId && existing.idempotencyKey === key && existing.decision === data.decision && existingData.evidenceReference === data.evidenceReference && existingData.reason === data.reason) return { id: existing.id, decision: existing.decision, replayed: true };
        throw new Error("status_already_reviewed");
      }
      const [priorKey] = await tx.select().from(metropolisStatusReviews).where(and(eq(metropolisStatusReviews.organizationId, event.organizationId), eq(metropolisStatusReviews.idempotencyKey, key!))).limit(1);
      if (priorKey) {
        const priorData = decryptOperationalData<{ evidenceReference: string; reason: string }>(priorKey.privateDataCiphertext, operationalContext({ organizationId: priorKey.organizationId, centreId: priorKey.centreId, recordId: priorKey.id }, "metropolis-status-review"));
        if (priorKey.statusEventId !== event.id || priorKey.reviewerStaffId !== access.staff.staffUserId || priorKey.decision !== data.decision || priorData.evidenceReference !== data.evidenceReference || priorData.reason !== data.reason) throw new Error("idempotency_conflict");
        return { id: priorKey.id, decision: priorKey.decision, replayed: true };
      }
      const reviewId = randomUUID();
      const privateDataCiphertext = encryptOperationalData({ evidenceReference: data.evidenceReference, reason: data.reason }, operationalContext({ organizationId: event.organizationId, centreId: event.centreId, recordId: reviewId }, "metropolis-status-review"));
      const [created] = await tx.insert(metropolisStatusReviews).values({ id: reviewId, organizationId: event.organizationId, centreId: event.centreId, statusEventId: event.id, decision: data.decision, privateDataCiphertext, idempotencyKey: key!, reviewerStaffId: access.staff.staffUserId }).returning({ id: metropolisStatusReviews.id, decision: metropolisStatusReviews.decision });
      await appendAuditEvent(tx, { organizationId: event.organizationId, centreId: event.centreId, actorStaffId: access.staff.staffUserId, action: `metropolis.status_${data.decision.toLowerCase()}`, entityType: "diagnostic_order", entityId: event.orderId, details: { statusEventId: event.id, decision: data.decision } });
      return { ...created, replayed: false };
    });
    return Response.json({ review }, { status: review.replayed ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["idempotency_conflict", "status_already_reviewed", "status_correction_exists"].includes(code)) return Response.json({ error: code }, { status: 409 });
    return Response.json({ error: "metropolis_status_unavailable" }, { status: 409 });
  }
}
