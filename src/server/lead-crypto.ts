import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export type LeadCryptoContext = { organizationId: string; centreId: string; recordId: string };
export type LeadPrivateData = {
  firstName: string; lastName: string; phone: string | null; email: string | null;
  interestedService: string | null; campaign: string | null; contactEvidenceReference: string | null;
  marketingEvidenceReference: string | null; lostReason: string | null;
};
type LeadField = "private-data" | "activity" | "followup-note" | "conversion-evidence" | "communication-draft";

function keyring() {
  let parsed: unknown;
  try { parsed = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("lead_encryption_key_unavailable"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("lead_encryption_key_invalid");
  const keys = new Map<string, Buffer>();
  for (const [id, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(id) || typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("lead_encryption_key_invalid");
    const key = Buffer.from(encoded, "base64"); if (key.length !== 32) throw new Error("lead_encryption_key_invalid"); keys.set(id, key);
  }
  if (!keys.size) throw new Error("lead_encryption_key_unavailable");
  return keys;
}
function activeKey() { const id = process.env.RUDRA_FIELD_ACTIVE_KEY_ID; const keys = keyring(); if (!id || !keys.has(id)) throw new Error("lead_encryption_key_unavailable"); return { id, key: keys.get(id)! }; }
function aad(field: LeadField, context: LeadCryptoContext, keyId: string) { return Buffer.from(`rudra:lead-data:v1:${context.organizationId}:${context.centreId}:${context.recordId}:${field}:${keyId}`); }
export function encryptLeadValue<T>(field: LeadField, value: T, context: LeadCryptoContext) {
  const key = activeKey(), nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key.key, nonce); cipher.setAAD(aad(field, context, key.id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${key.id}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
export function decryptLeadValue<T>(field: LeadField, envelope: string | null, context: LeadCryptoContext): T {
  if (!envelope) throw new Error("lead_data_integrity_failed");
  const [version, keyId, nonceText, tagText, ciphertext, ...extra] = envelope.split(".");
  if (version !== "v1" || !keyId || !nonceText || !tagText || ciphertext === undefined || extra.length) throw new Error("lead_data_integrity_failed");
  const key = keyring().get(keyId); if (!key) throw new Error("lead_encryption_key_unavailable");
  try { const nonce = Buffer.from(nonceText, "base64url"), tag = Buffer.from(tagText, "base64url"); if (nonce.length !== 12 || tag.length !== 16) throw new Error(); const decipher = createDecipheriv("aes-256-gcm", key, nonce); decipher.setAAD(aad(field, context, keyId)); decipher.setAuthTag(tag); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")) as T; }
  catch { throw new Error("lead_data_integrity_failed"); }
}
export function blindIndexLeadContact(field: "phone" | "email", value: string) {
  const encoded = process.env.RUDRA_BLIND_INDEX_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("lead_blind_index_key_unavailable");
  const key = Buffer.from(encoded, "base64"); if (key.length !== 32) throw new Error("lead_blind_index_key_invalid");
  const normalized = field === "phone" ? value.trim().replace(/[ ()-]/g, "") : value.trim().toLocaleLowerCase("en-US");
  return createHmac("sha256", key).update(`rudra:lead-contact-index:v1:${field}:`).update(normalized).digest("hex");
}
export function encryptLeadPrivateData(value: LeadPrivateData, context: LeadCryptoContext) { return encryptLeadValue("private-data", value, context); }
export function decryptLeadPrivateData(value: string | null, context: LeadCryptoContext) {
  const payload = decryptLeadValue<LeadPrivateData>("private-data", value, context);
  if (!payload || typeof payload.firstName !== "string" || typeof payload.lastName !== "string" || !(payload.phone === null || typeof payload.phone === "string") || !(payload.email === null || typeof payload.email === "string")) throw new Error("lead_data_integrity_failed");
  return payload;
}
