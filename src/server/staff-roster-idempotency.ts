import { createHash } from "node:crypto";

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function shiftCreateFingerprint(input: Record<string, unknown>) { return hash(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "note"))); }
export function legacyShiftCreateFingerprint(input: Record<string, unknown>) { return hash(input); }
export function sameShiftPrivateNote(stored: unknown, note: string) { return Boolean(stored && typeof stored === "object" && !Array.isArray(stored) && (stored as Record<string, unknown>).note === note); }
export function handoverCreateFingerprint(input: Record<string, unknown>) { return hash(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "handoverNote"))); }
export function legacyHandoverCreateFingerprint(input: Record<string, unknown>) { return hash(input); }
export function sameHandoverPrivateNote(stored: unknown, note: string) { return Boolean(stored && typeof stored === "object" && !Array.isArray(stored) && (stored as Record<string, unknown>).handoverNote === note); }
export function handoverActionFingerprint(id: string, input: Record<string, unknown>) { return hash({ id, ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== "reason")) }); }
export function legacyHandoverActionFingerprint(_id: string, input: Record<string, unknown>) { return hash(input); }
export function sameHandoverActionReason(stored: unknown, requested: string) { return Boolean(stored && typeof stored === "object" && !Array.isArray(stored) && (stored as Record<string, unknown>).reason === requested); }
