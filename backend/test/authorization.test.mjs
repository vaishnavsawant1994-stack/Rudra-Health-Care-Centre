import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCentre, assertPermission, canAccessCentre, hasPermission, HttpError, parsePage, validateLeadTransition, validateName } from '../src/authorization.mjs';

test('permissions are explicit and centre scope is enforced', () => {
  const principal = { permissions: new Set(['patients.read']), centres: ['centre-a'] };
  assert.doesNotThrow(() => assertPermission(principal, 'patients.read'));
  assert.throws(() => assertPermission(principal, 'patients.update'), (error) => error instanceof HttpError && error.status === 403);
  assert.equal(canAccessCentre(principal, 'centre-a'), true);
  assert.equal(canAccessCentre(principal, 'centre-b'), false);
  assert.throws(() => assertCentre(principal, 'centre-b'), /outside your assigned centre access/);
  assert.equal(canAccessCentre({ centres: [null] }, 'any-centre'), true);
});

test('permission grants stay tied to the centre where each role was assigned', () => {
  const principal = {
    permissions: new Set(['patients.read','patients.update']),
    permissionCentres: new Map([['patients.read',['centre-a']], ['patients.update',['centre-b']]]),
    centres: ['centre-a','centre-b']
  };
  assert.equal(hasPermission(principal, 'patients.read', 'centre-a'), true);
  assert.equal(hasPermission(principal, 'patients.read', 'centre-b'), false);
  assert.equal(hasPermission(principal, 'patients.update', 'centre-a'), false);
  assert.equal(hasPermission(principal, 'patients.update', 'centre-b'), true);
});

test('pagination defaults and caps untrusted values', () => {
  assert.deepEqual(parsePage(new URL('https://rudra.invalid/patients')), { limit: 25, offset: 0 });
  assert.deepEqual(parsePage(new URL('https://rudra.invalid/patients?limit=500&offset=3')), { limit: 100, offset: 3 });
  assert.throws(() => parsePage(new URL('https://rudra.invalid/patients?limit=2.2')), /whole numbers/);
});

test('lead state machine rejects terminal shortcuts and illegal transitions', () => {
  assert.doesNotThrow(() => validateLeadTransition('NEW', 'CONTACTED'));
  assert.throws(() => validateLeadTransition('CONVERTED', 'NEW'), /cannot move/);
  assert.throws(() => validateLeadTransition('LOST', 'CONVERTED'), /cannot move/);
});

test('patient names are normalized and bounded', () => {
  assert.equal(validateName('  Vaishnav  '), 'Vaishnav');
  assert.throws(() => validateName(' '), /required/);
  assert.throws(() => validateName('x'.repeat(121)), /120 characters/);
});
