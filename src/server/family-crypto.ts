import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export type FamilyCryptoContext = { organizationId: string; centreId: string; recordId: string };
type FamilyField = "display-name" | "member-evidence" | "grant-purpose" | "grant-evidence" | "contact-evidence";
function ring() {
  let parsed: unknown;
  try { parsed = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("family_encryption_key_unavailable"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("family_encryption_key_invalid");
  const keys = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(id) || typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("family_encryption_key_invalid");
    const key = Buffer.from(value, "base64"); if (key.length !== 32) throw new Error("family_encryption_key_invalid"); keys.set(id, key);
  }
  return keys;
}
function active() { const id = process.env.RUDRA_FIELD_ACTIVE_KEY_ID; const keys = ring(); if (!id || !keys.has(id)) throw new Error("family_encryption_key_unavailable"); return { id, key: keys.get(id)! }; }
function aad(field: FamilyField, context: FamilyCryptoContext, keyId: string) { return Buffer.from(`rudra:family-data:v1:${context.organizationId}:${context.centreId}:${context.recordId}:${field}:${keyId}`); }
export function encryptFamilyValue(field: FamilyField, value: string | null, context: FamilyCryptoContext): string | null {
  if (value === null) return null;
  const key = active(); const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key.key, iv); cipher.setAAD(aad(field, context, key.id));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${key.id}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
export function decryptFamilyValue(field: FamilyField, envelope: string | null, context: FamilyCryptoContext): string | null {
  if (envelope === null) return null;
  const [version, keyId, ivText, tagText, cipherText, ...extra] = envelope.split(".");
  if (version !== "v1" || !keyId || !ivText || !tagText || cipherText === undefined || extra.length) throw new Error("family_data_integrity_failed");
  const key = ring().get(keyId); if (!key) throw new Error("family_encryption_key_unavailable");
  try { const iv = Buffer.from(ivText, "base64url"), tag = Buffer.from(tagText, "base64url"); if (iv.length !== 12 || tag.length !== 16) throw new Error(); const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAAD(aad(field, context, keyId)); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]).toString("utf8"); }
  catch { throw new Error("family_data_integrity_failed"); }
}
export function blindIndexFamilyName(value: string) {
  const raw = process.env.RUDRA_BLIND_INDEX_KEY;
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error("family_blind_index_key_unavailable");
  const key = Buffer.from(raw, "base64"); if (key.length !== 32) throw new Error("family_blind_index_key_invalid");
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return createHmac("sha256", key).update("rudra:family-name-index:v1:").update(normalized).digest("hex");
}
