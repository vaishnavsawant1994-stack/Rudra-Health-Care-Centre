import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { communicationGovernanceEvents, communicationGovernanceRecords } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { hasPermission } from "@/server/permissions";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { governanceUpdateSchema } from "@/server/communication-governance-policy";

type Context = { params: Promise<{ id: string }> };
const eventContext = (organizationId: string, centreId: string, eventId: string) => operationalContext({ organizationId, centreId, recordId: eventId }, "communications-governance-event");
const recordContext = (organizationId: string, centreId: string, recordId: string) => operationalContext({ organizationId, centreId, recordId }, "communications-governance-record");
const responseRecord = (row: typeof communicationGovernanceRecords.$inferSelect) => ({ id: row.id, centreId: row.centreId, recordKind: row.recordKind, channel: row.channel, status: row.status, versionNumber: row.versionNumber, privateData: decryptOperationalData<Record<string, unknown>>(row.privateDataCiphertext, recordContext(row.organizationId, row.centreId, row.id)), createdAt: row.createdAt, updatedAt: row.updatedAt });

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = governanceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_governance_draft" }, { status: 400 });
  const data = parsed.data;
  const access = await getApiAccess("configuration.manage", data.centreId);
  if (access.response) return access.response;
  if (!hasPermission(access.staff.grants, "configuration.manage", data.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!z.uuid().safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const requestPayload = { id: id.data, actorStaffId: access.staff.staffUserId, ...data };
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:communications-governance-update:${idempotencyKey}`},0))`);
      const [row] = await tx.select().from(communicationGovernanceRecords).where(and(eq(communicationGovernanceRecords.id, id.data), eq(communicationGovernanceRecords.organizationId, access.staff.organizationId), eq(communicationGovernanceRecords.centreId, data.centreId))).for("update").limit(1);
      if (!row || row.recordKind !== data.recordKind || row.channel !== ("channel" in data ? data.channel : null)) throw new Error("not_found");
      if (row.status !== "DRAFT") throw new Error("invalid_transition");
      const fingerprintContext = operationalContext({ organizationId: row.organizationId, centreId: row.centreId, recordId: `${row.id}:${idempotencyKey}` }, "communications-governance-update-idempotency");
      const requestHash = fingerprintOperationalRequest(requestPayload, fingerprintContext);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${row.organizationId}:communications-governance-event:${idempotencyKey}`},0))`);
      const [prior] = await tx.select().from(communicationGovernanceEvents).where(and(eq(communicationGovernanceEvents.organizationId, row.organizationId), eq(communicationGovernanceEvents.idempotencyKey, idempotencyKey!))).limit(1);
      if (prior) {
        if (prior.recordId !== row.id || prior.actorStaffId !== access.staff.staffUserId || !verifyOperationalRequestFingerprint(requestPayload, prior.requestHash, fingerprintContext)) throw new Error("idempotency_conflict");
        return { row, replayed: true };
      }
      if (row.versionNumber !== data.expectedVersion) throw new Error("version_conflict");
      const nextVersion = row.versionNumber + 1;
      const [updated] = await tx.update(communicationGovernanceRecords).set({ privateDataCiphertext: encryptOperationalData(data.privateData, recordContext(row.organizationId, row.centreId, row.id)), versionNumber: nextVersion, updatedByStaffId: access.staff.staffUserId, updatedAt: new Date() }).where(and(eq(communicationGovernanceRecords.id, row.id), eq(communicationGovernanceRecords.versionNumber, row.versionNumber))).returning();
      if (!updated) throw new Error("version_conflict");
      const eventId = randomUUID();
      await tx.insert(communicationGovernanceEvents).values({ id: eventId, organizationId: row.organizationId, centreId: row.centreId, recordId: row.id, actorStaffId: access.staff.staffUserId, eventType: "UPDATED", privateDataCiphertext: encryptOperationalData({ previousVersion: row.versionNumber, versionNumber: nextVersion, recordKind: row.recordKind }, eventContext(row.organizationId, row.centreId, eventId)), idempotencyKey: idempotencyKey!, requestHash });
      await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: access.staff.staffUserId, action: "communications.governance_draft_updated", entityType: "communications_governance_record", entityId: row.id, details: { recordKind: row.recordKind, channel: row.channel, status: "DRAFT", versionNumber: nextVersion } });
      return { row: updated, replayed: false };
    });
    return Response.json({ record: responseRecord(result.row), replayed: result.replayed, delivery: "DISABLED", publication: "DISABLED" }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "not_found" ? 404 : code === "version_conflict" || code === "idempotency_conflict" || code === "invalid_transition" ? 409 : 503;
    return Response.json({ error: status === 503 ? "governance_draft_unavailable" : code }, { status });
  }
}
