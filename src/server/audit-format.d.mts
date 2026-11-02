export const GENESIS_AUDIT_HASH: string;
export function canonicalJson(value: unknown): string;
export function auditEventPayload(event: Record<string, unknown>): Record<string, unknown>;
export function computeAuditEventHash(event: Record<string, unknown>, previousHash: string): string;
export function verifyAuditChain(events: Array<Record<string, unknown> & { id: string; previousHash: string; eventHash: string }>): { valid: true; verifiedEvents: number; headHash: string } | { valid: false; eventId: string };
