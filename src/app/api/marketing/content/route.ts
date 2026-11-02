import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { marketingContentEvents, marketingContentItems } from "@/db/schema";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { isSameOriginRequest, csrfRejected } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { hasPermission } from "@/server/permissions";
import { marketingContentCreateSchema, marketingContentListSchema } from "@/server/marketing-content-policy";

type PrivateData = { title: string; body: string; internalNote: string | null };
const context = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "marketing-content");
const eventContext = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "marketing-content-event");
const reveal = (row: typeof marketingContentItems.$inferSelect) => ({ id: row.id, centreId: row.centreId, campaignId: row.campaignId, channel: row.channel, contentType: row.contentType, status: row.status, plannedPublishAt: row.plannedPublishAt, versionNumber: row.versionNumber, createdByStaffId: row.createdByStaffId, reviewedByStaffId: row.reviewedByStaffId, ...decryptOperationalData<PrivateData>(row.privateDataCiphertext, context(row.organizationId, row.centreId, row.id)), createdAt: row.createdAt, updatedAt: row.updatedAt });

export async function GET(request: Request) {
  const parsed = marketingContentListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const access = await getApiAccess("marketing.read", parsed.data.centreId);
  if (access.response) return access.response;
  if (!access.staff || !hasPermission(access.staff.grants, "marketing.read", parsed.data.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const rows = await getDb().select().from(marketingContentItems).where(and(eq(marketingContentItems.organizationId, access.staff.organizationId), eq(marketingContentItems.centreId, parsed.data.centreId), parsed.data.status === "ALL" ? undefined : eq(marketingContentItems.status, parsed.data.status))).orderBy(desc(marketingContentItems.updatedAt), desc(marketingContentItems.id)).limit(100);
  try { return Response.json({ items: rows.map(reveal), externalPublishing: "DISABLED" }, { headers: { "cache-control": "private, no-store" } }); }
  catch { return Response.json({ error: "content_unavailable" }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) return Response.json({ error: "invalid_input" }, { status: 413 });
  const parsed = marketingContentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_content", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const data = parsed.data;
  const access = await getApiAccess("marketing.manage", data.centreId);
  if (access.response) return access.response;
  if (!access.staff || !hasPermission(access.staff.grants, "marketing.manage", data.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const fingerprintContext = operationalContext({ organizationId: access.staff.organizationId, centreId: data.centreId, recordId: data.idempotencyKey }, "marketing-content-create-idempotency");
  const fingerprint = fingerprintOperationalRequest(data, fingerprintContext);
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:marketing-content:${data.idempotencyKey}`},0))`);
      const [existing] = await tx.select().from(marketingContentItems).where(and(eq(marketingContentItems.organizationId, access.staff.organizationId), eq(marketingContentItems.idempotencyKey, data.idempotencyKey))).limit(1);
      if (existing) {
        if (existing.createdByStaffId !== access.staff.staffUserId || !verifyOperationalRequestFingerprint(data, existing.requestFingerprint, fingerprintContext)) throw new Error("idempotency_conflict");
        return { row: existing, replayed: true };
      }
      const id = randomUUID();
      const [created] = await tx.insert(marketingContentItems).values({ id, organizationId: access.staff.organizationId, centreId: data.centreId, campaignId: data.campaignId ?? null, channel: data.channel, contentType: data.contentType, status: "DRAFT", privateDataCiphertext: encryptOperationalData({ title: data.title, body: data.body, internalNote: data.internalNote ?? null }, context(access.staff.organizationId, data.centreId, id)), createdByStaffId: access.staff.staffUserId, updatedByStaffId: access.staff.staffUserId, idempotencyKey: data.idempotencyKey, requestFingerprint: fingerprint }).returning();
      const eventId = randomUUID();
      await tx.insert(marketingContentEvents).values({ id: eventId, organizationId: access.staff.organizationId, centreId: data.centreId, contentItemId: id, actorStaffId: access.staff.staffUserId, eventType: "CREATED", privateDataCiphertext: encryptOperationalData({ status: "DRAFT", versionNumber: 1, title: data.title }, eventContext(access.staff.organizationId, data.centreId, eventId)), idempotencyKey: data.idempotencyKey, requestFingerprint: fingerprint });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: data.centreId, actorStaffId: access.staff.staffUserId, action: "marketing.content_created", entityType: "marketing_content_item", entityId: id, details: { channel: data.channel, contentType: data.contentType, status: "DRAFT" } });
      return { row: created, replayed: false };
    });
    return Response.json({ item: reveal(result.row), replayed: result.replayed, externalPublishing: "DISABLED" }, { status: result.replayed ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) { const conflict = error instanceof Error && error.message === "idempotency_conflict"; return Response.json({ error: conflict ? "idempotency_conflict" : "content_unavailable" }, { status: conflict ? 409 : 409 }); }
}
