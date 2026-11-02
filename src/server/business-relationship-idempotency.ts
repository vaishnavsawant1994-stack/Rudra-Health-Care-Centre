import { createHash } from "node:crypto";
import type { BusinessRelationshipPrivateData } from "@/server/business-relationship-data";

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function relationshipCreateFingerprint(input: { centreId: string; type: string; category: string }) { return hash(input); }
export function relationshipUpdateFingerprint(input: { id: string; centreId: string; type: string; expectedVersion: number; category: string; status: string }) { return hash(input); }
export function legacyRelationshipCreateFingerprint(input: unknown) { return hash(input); }
export function legacyRelationshipUpdateFingerprint(input: unknown) { return hash(input); }
export function relationshipActivityFingerprint(input: { id: string; centreId: string; type: string; category: string; occurredAt: string | null }) { return hash(input); }
export function legacyRelationshipActivityFingerprint(input: unknown) { return hash(input); }

export function sameRelationshipPrivateData(left: unknown, right: BusinessRelationshipPrivateData) {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const value = left as Record<string, unknown>;
  return Object.entries(right).every(([key, field]) => value[key] === field);
}

export function sameRelationshipActivityPrivateData(left: unknown, right: { serviceReference: string | null; note: string | null }) {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const value = left as Record<string, unknown>;
  return value.serviceReference === right.serviceReference && value.note === right.note;
}
