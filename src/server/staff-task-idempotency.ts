import { createHash } from "node:crypto";

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function taskCreateFingerprint(data: Record<string, unknown>) {
  return fingerprint(Object.fromEntries(Object.entries(data).filter(([key]) => key !== "title" && key !== "description")));
}

export function taskActionFingerprint(taskId: string, actorStaffId: string, payload: Record<string, unknown>) {
  const publicPayload = Object.fromEntries(Object.entries(payload).filter(([key]) => !["title", "description", "comment", "reason"].includes(key)));
  return fingerprint({ taskId, actorStaffId, ...publicPayload });
}

export function legacyTaskCreateFingerprint(data: Record<string, unknown>) {
  return fingerprint(data);
}

export function legacyTaskActionFingerprint(taskId: string, actorStaffId: string, payload: Record<string, unknown>) {
  return fingerprint({ taskId, actorStaffId, ...payload });
}

export function sameTaskCreatePrivateData(stored: unknown, requested: Record<string, unknown>) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  const value = stored as Record<string, unknown>;
  return value.title === requested.title && value.description === requested.description;
}

export function sameTaskActionPrivateData(stored: unknown, requested: Record<string, unknown>) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  const value = stored as Record<string, unknown>;
  return ["title", "description", "comment", "reason"].every((key) => value[key] === (requested[key] ?? null))
    && (requested.supportResolutionOutcome === undefined || value.supportResolutionOutcome === requested.supportResolutionOutcome);
}
