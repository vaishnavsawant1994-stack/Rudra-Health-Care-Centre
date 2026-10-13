import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptField, encryptField, hmacLookup, maskMobile, newOpaqueToken, readSignedCookie, sha256, signedCookie } from '../src/security.mjs';

const encryptionKey = Buffer.alloc(32, 7);
const signingKey = Buffer.alloc(32, 8);
const lookupKey = Buffer.alloc(32, 9);

test('encrypted contact data round-trips and uses distinct ciphertexts', () => {
  const first = encryptField('+919876543210', encryptionKey);
  const second = encryptField('+919876543210', encryptionKey);
  assert.equal(decryptField(first, encryptionKey), '+919876543210');
  assert.notDeepEqual(first, second);
  assert.throws(() => decryptField(first, Buffer.alloc(32, 1)));
});

test('lookup hashes are stable while contact values remain masked', () => {
  assert.deepEqual(hmacLookup('+919876543210', lookupKey), hmacLookup('+919876543210', lookupKey));
  assert.notDeepEqual(hmacLookup('+919876543210', lookupKey), hmacLookup('+919876543211', lookupKey));
  assert.equal(maskMobile('+91 98765 43210'), '•••••••••3210');
});

test('signed OIDC transaction cookie rejects tampering', () => {
  const token = signedCookie({ state: 'random-state', expires: 10 }, signingKey);
  assert.deepEqual(readSignedCookie(token, signingKey), { state: 'random-state', expires: 10 });
  assert.equal(readSignedCookie(`${token}x`, signingKey), null);
  assert.equal(readSignedCookie(token, Buffer.alloc(32, 4)), null);
});

test('session secrets have enough entropy and deterministic hashes do not reveal input', () => {
  const token = newOpaqueToken();
  assert.ok(Buffer.from(token, 'base64url').length >= 32);
  assert.equal(sha256(token).length, 32);
  assert.notEqual(sha256(token).toString('hex'), token);
});
