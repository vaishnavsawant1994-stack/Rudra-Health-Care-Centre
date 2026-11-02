import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type OperationalCryptoContext = { organizationId: string; centreId: string; recordType: string; recordId: string };

function keyring() {
  let parsed: unknown;
  try { parsed = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("operational_encryption_key_unavailable"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("operational_encryption_key_invalid");
  const keys = new Map<string, Buffer>();
  for (const [id, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(id) || typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("operational_encryption_key_invalid");
    const key = Buffer.from(encoded, "base64"); if (key.length !== 32) throw new Error("operational_encryption_key_invalid"); keys.set(id, key);
  }
  return keys;
}

function aad(context: OperationalCryptoContext, keyId: string) {
  if (!/^[a-z0-9_-]{1,48}$/.test(context.recordType)) throw new Error("operational_encryption_context_invalid");
  return Buffer.from(`rudra:operational-data:v1:${context.organizationId}:${context.centreId}:${context.recordType}:${context.recordId}:${keyId}`);
}

export function encryptOperationalData<T>(value: T, context: OperationalCryptoContext) {
  const id = process.env.RUDRA_FIELD_ACTIVE_KEY_ID; const key = id ? keyring().get(id) : undefined;
  if (!id || !key) throw new Error("operational_encryption_key_unavailable");
  const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(aad(context, id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${id}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptOperationalData<T>(envelope: string | null, context: OperationalCryptoContext): T {
  if (!envelope) throw new Error("operational_data_integrity_failed");
  const [version, id, nonceText, tagText, data, ...extra] = envelope.split(".");
  if (version !== "v1" || !id || !nonceText || !tagText || data === undefined || extra.length) throw new Error("operational_data_integrity_failed");
  const key = keyring().get(id); if (!key) throw new Error("operational_encryption_key_unavailable");
  try {
    const nonce = Buffer.from(nonceText, "base64url"), tag = Buffer.from(tagText, "base64url");
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce); decipher.setAAD(aad(context, id)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")) as T;
  } catch { throw new Error("operational_data_integrity_failed"); }
}

export function operationalContext(input: { organizationId: string; centreId: string; recordId: string }, recordType: string): OperationalCryptoContext {
  return { organizationId: input.organizationId, centreId: input.centreId, recordType, recordId: input.recordId };
}

/** Keyed request fingerprint avoids offline guessing of low-entropy private fields. */
export function fingerprintOperationalRequest(value: unknown, context: OperationalCryptoContext) {
  const activeId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  const keys = keyring();
  const activeKey = activeId ? keys.get(activeId) : undefined;
  if (!activeId || !activeKey) throw new Error("operational_encryption_key_unavailable");
  const fingerprintKey = createHmac("sha256", activeKey).update("rudra:request-fingerprint:v1").digest();
  return createHmac("sha256", fingerprintKey).update(aad(context, activeId)).update("\0").update(JSON.stringify(value)).digest("hex");
}

/** Retained key versions keep retry verification working during key rotation. */
export function verifyOperationalRequestFingerprint(value: unknown, fingerprint: string, context: OperationalCryptoContext) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) return false;
  const expected = Buffer.from(fingerprint, "hex");
  for (const [keyId, key] of keyring()) {
    const fingerprintKey = createHmac("sha256", key).update("rudra:request-fingerprint:v1").digest();
    const candidate = createHmac("sha256", fingerprintKey).update(aad(context, keyId)).update("\0").update(JSON.stringify(value)).digest();
    if (timingSafeEqual(expected, candidate)) return true;
  }
  return false;
}
