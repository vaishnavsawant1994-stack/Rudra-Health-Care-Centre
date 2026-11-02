import { createHash } from "node:crypto";

export type EscalationCreateRequest = {
  centreId: string;
  source: { type: string; id: string };
  title: string;
  description: string;
  severity: string;
  priority: string;
  assignedOwnerStaffId: string;
  dueAt: string;
  deduplicateOpenSource: boolean;
};

/** Hash only non-private request fields; private text is compared after authorized decryption. */
export function escalationRequestFingerprint(data: EscalationCreateRequest) {
  const publicFields = {
    centreId: data.centreId,
    source: data.source,
    severity: data.severity,
    priority: data.priority,
    assignedOwnerStaffId: data.assignedOwnerStaffId,
    dueAt: data.dueAt,
    deduplicateOpenSource: data.deduplicateOpenSource,
  };
  return createHash("sha256").update(JSON.stringify(publicFields)).digest("hex");
}

/** Compatibility check for idempotency keys created before private data was excluded from hashes. */
export function legacyEscalationRequestFingerprint(data: EscalationCreateRequest) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export function sameEscalationPrivateRequest(left: unknown, right: Pick<EscalationCreateRequest, "title" | "description">) {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const value = left as Record<string, unknown>;
  return value.title === right.title && value.description === right.description;
}

export type EscalationActionRequest = { action: string; expectedVersion: number; comment?: string; reason?: string; [field: string]: unknown };

function actionPublicFields(escalationId: string, action: EscalationActionRequest) {
  const publicAction = Object.fromEntries(Object.entries(action).filter(([key]) => key !== "comment" && key !== "reason"));
  return { escalationId, action: publicAction };
}

export function escalationActionFingerprint(escalationId: string, action: EscalationActionRequest) {
  return createHash("sha256").update(JSON.stringify(actionPublicFields(escalationId, action))).digest("hex");
}

export function legacyEscalationActionFingerprint(escalationId: string, action: EscalationActionRequest) {
  return createHash("sha256").update(JSON.stringify({ escalationId, action })).digest("hex");
}

export function sameEscalationPrivateAction(left: unknown, right: EscalationActionRequest) {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const value = left as Record<string, unknown>;
  return value.reason === (right.reason ?? null) && value.comment === (right.action === "COMMENT" ? right.comment ?? null : null);
}
