import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { communicationGovernanceEvents, communicationGovernanceRecords, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { hasPermission } from "@/server/permissions";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { governanceCreateSchema } from "@/server/communication-governance-policy";

type PrivateData = Record<string, unknown>;
const context = (organizationId: string, centreId: string, id: string, kind: "record" | "event") => operationalContext({ organizationId, centreId, recordId: id }, `communications-governance-${kind}`);
const reveal = (row: typeof communicationGovernanceRecords.$inferSelect) => ({ id: row.id, centreId: row.centreId, recordKind: row.recordKind, channel: row.channel, status: row.status, versionNumber: row.versionNumber, privateData: decryptOperationalData<PrivateData>(row.privateDataCiphertext, context(row.organizationId, row.centreId, row.id, "record")), createdAt: row.createdAt, updatedAt: row.updatedAt });

export async function GET(request: Request) {
  const parsed = z.object({ centreId: z.uuid(), recordKind: z.enum(["PROVIDER_POLICY", "KNOWLEDGE"]) }).safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const access = await getApiAccess("configuration.read", parsed.data.centreId);
  if (access.response) return access.response;
  if (!hasPermission(access.staff.grants, "configuration.read", parsed.data.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const rows = await getDb().select().from(communicationGovernanceRecords).where(and(
    eq(communicationGovernanceRecords.organizationId, access.staff.organizationId),
    eq(communicationGovernanceRecords.centreId, parsed.data.centreId),
    eq(communicationGovernanceRecords.recordKind, parsed.data.recordKind),
  )).orderBy(desc(communicationGovernanceRecords.updatedAt), desc(communicationGovernanceRecords.id)).limit(100);
  const history = rows.length ? await getDb().select({ recordId: communicationGovernanceEvents.recordId, eventType: communicationGovernanceEvents.eventType, recordedAt: communicationGovernanceEvents.recordedAt, actorName: staffUsers.displayName }).from(communicationGovernanceEvents)
    .innerJoin(staffUsers, and(eq(staffUsers.id, communicationGovernanceEvents.actorStaffId), eq(staffUsers.organizationId, communicationGovernanceEvents.organizationId)))
    .where(and(eq(communicationGovernanceEvents.organizationId, access.staff.organizationId), eq(communicationGovernanceEvents.centreId, parsed.data.centreId), inArray(communicationGovernanceEvents.recordId, rows.map((row) => row.id)))).orderBy(desc(communicationGovernanceEvents.recordedAt)).limit(300) : [];
  return Response.json({ records: rows.map(reveal), history: history.map(({ recordId, eventType, recordedAt, actorName }) => ({ recordId, eventType, recordedAt, actorName })), delivery: "DISABLED", publication: "DISABLED" }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = governanceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_governance_draft" }, { status: 400 });
  const data = parsed.data;
  const access = await getApiAccess("configuration.manage", data.centreId);
  if (access.response) return access.response;
  if (!hasPermission(access.staff.grants, "configuration.manage", data.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const requestHash = fingerprintOperationalRequest(data, operationalContext({ organizationId: access.staff.organizationId, centreId: data.centreId, recordId: data.idempotencyKey }, "communications-governance-create-idempotency"));
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:communications-governance:${data.idempotencyKey}`},0))`);
      const [prior] = await tx.select().from(communicationGovernanceRecords).where(and(eq(communicationGovernanceRecords.organizationId, access.staff.organizationId), eq(communicationGovernanceRecords.idempotencyKey, data.idempotencyKey))).limit(1);
      if (prior) {
        if (prior.centreId !== data.centreId || prior.recordKind !== data.recordKind || prior.channel !== ("channel" in data ? data.channel : null) || !verifyOperationalRequestFingerprint(data, prior.requestHash, operationalContext({ organizationId: prior.organizationId, centreId: data.centreId, recordId: data.idempotencyKey }, "communications-governance-create-idempotency"))) throw new Error("idempotency_conflict");
        return { row: prior, replayed: true };
      }
      const id = randomUUID();
      const encrypted = encryptOperationalData(data.privateData, context(access.staff.organizationId, data.centreId, id, "record"));
      const [row] = await tx.insert(communicationGovernanceRecords).values({ id, organizationId: access.staff.organizationId, centreId: data.centreId, recordKind: data.recordKind, channel: "channel" in data ? data.channel : null, status: "DRAFT", versionNumber: 1, privateDataCiphertext: encrypted, createdByStaffId: access.staff.staffUserId, updatedByStaffId: access.staff.staffUserId, idempotencyKey: data.idempotencyKey, requestHash }).returning();
      const eventId = randomUUID();
      await tx.insert(communicationGovernanceEvents).values({ id: eventId, organizationId: row.organizationId, centreId: row.centreId, recordId: row.id, actorStaffId: access.staff.staffUserId, eventType: "CREATED", privateDataCiphertext: encryptOperationalData({ versionNumber: 1, recordKind: row.recordKind, status: "DRAFT" }, context(row.organizationId, row.centreId, eventId, "event")), idempotencyKey: data.idempotencyKey, requestHash });
      await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: access.staff.staffUserId, action: "communications.governance_draft_created", entityType: "communications_governance_record", entityId: row.id, details: { recordKind: row.recordKind, channel: row.channel, status: "DRAFT" } });
      return { row, replayed: false };
    });
    return Response.json({ record: reveal(result.row), replayed: result.replayed, delivery: "DISABLED", publication: "DISABLED" }, { status: result.replayed ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof Error && error.message === "idempotency_conflict" ? 409 : 503;
    return Response.json({ error: status === 409 ? "idempotency_conflict" : "governance_draft_unavailable" }, { status });
  }
}
