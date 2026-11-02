import { createHash } from "node:crypto";

export const GENESIS_AUDIT_HASH = "0".repeat(64);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function auditEventPayload(event) {
  return {
    id: event.id,
    organizationId: event.organizationId ?? null,
    centreId: event.centreId ?? null,
    actorStaffId: event.actorStaffId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    details: event.details ?? {},
    recordedAt: event.recordedAt instanceof Date ? event.recordedAt.toISOString() : event.recordedAt,
  };
}

export function computeAuditEventHash(event, previousHash) {
  return createHash("sha256").update(`${previousHash}\n${canonicalJson(auditEventPayload(event))}`, "utf8").digest("hex");
}

export function verifyAuditChain(events) {
  let previousHash = GENESIS_AUDIT_HASH;
  for (const event of events) {
    if (event.previousHash !== previousHash) return { valid: false, eventId: event.id };
    const expected = computeAuditEventHash(event, previousHash);
    if (expected !== event.eventHash) return { valid: false, eventId: event.id };
    previousHash = event.eventHash;
  }
  return { valid: true, verifiedEvents: events.length, headHash: previousHash };
}
