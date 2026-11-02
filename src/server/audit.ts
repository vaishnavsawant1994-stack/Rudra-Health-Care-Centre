import { randomUUID } from "node:crypto";
import { desc, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as authSchema from "@/db/auth-schema";
import * as appSchema from "@/db/schema";
import { auditEvents } from "@/db/schema";
import { GENESIS_AUDIT_HASH, computeAuditEventHash } from "./audit-format.mjs";

type Database = NodePgDatabase<typeof authSchema & typeof appSchema>;

export type AuditInput = {
  organizationId?: string | null;
  centreId?: string | null;
  actorStaffId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, string | number | boolean | string[] | null>;
};

export async function appendAuditEvent(db: Database, input: AuditInput) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(741220251, 3)`);
    const [last] = await transaction.select({ eventHash: auditEvents.eventHash }).from(auditEvents).orderBy(desc(auditEvents.sequence)).limit(1);
    const recordedAt = new Date();
    const event = {
      id: randomUUID(),
      organizationId: input.organizationId ?? null,
      centreId: input.centreId ?? null,
      actorStaffId: input.actorStaffId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      details: input.details ?? {},
      recordedAt,
    };
    const previousHash = last?.eventHash ?? GENESIS_AUDIT_HASH;
    const eventHash = computeAuditEventHash(event, previousHash);
    await transaction.insert(auditEvents).values({ ...event, previousHash, eventHash });
    return event.id;
  });
}

export async function readAuditChain(db: Database) {
  return db.select({
    id: auditEvents.id,
    organizationId: auditEvents.organizationId,
    centreId: auditEvents.centreId,
    actorStaffId: auditEvents.actorStaffId,
    action: auditEvents.action,
    entityType: auditEvents.entityType,
    entityId: auditEvents.entityId,
    details: auditEvents.details,
    previousHash: auditEvents.previousHash,
    eventHash: auditEvents.eventHash,
    recordedAt: auditEvents.recordedAt,
  }).from(auditEvents).orderBy(auditEvents.sequence);
}
