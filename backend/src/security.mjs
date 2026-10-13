import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const decodeKey = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be a base64-encoded 32-byte key`);
  return key;
};

export const hmacLookup = (value, key = decodeKey('RUDRA_LOOKUP_HMAC_KEY')) =>
  createHmac('sha256', key).update(value).digest();

export function encryptField(value, key = decodeKey('RUDRA_FIELD_ENCRYPTION_KEY')) {
  if (value == null || value === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptField(payload, key = decodeKey('RUDRA_FIELD_ENCRYPTION_KEY')) {
  if (payload == null) return null;
  const bytes = Buffer.from(payload);
  if (bytes.length < 30 || bytes[0] !== 1) throw new Error('Unsupported encrypted field format');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13));
  decipher.setAuthTag(bytes.subarray(13, 29));
  return Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8');
}

export const normalizeMobile = (value) => String(value).replace(/[\s().-]/g, '');

export const maskMobile = (value) => {
  const normalized = normalizeMobile(value);
  return `${normalized.slice(0, Math.max(0, normalized.length - 4)).replace(/./g, '•')}${normalized.slice(-4)}`;
};

export function signedCookie(value, key = decodeKey('RUDRA_COOKIE_SIGNING_KEY')) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const mac = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function readSignedCookie(value, key = decodeKey('RUDRA_COOKIE_SIGNING_KEY')) {
  if (!value || typeof value !== 'string') return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', key).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
}

export const newOpaqueToken = () => randomBytes(32).toString('base64url');
export const sha256 = (value) => createHash('sha256').update(value).digest();
