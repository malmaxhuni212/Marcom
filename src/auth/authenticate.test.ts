import assert from 'node:assert/strict';
import test from 'node:test';
import { hashLoginDimension } from './authenticate';

const TEST_SECRET = 'test-only-auth-secret-with-at-least-32-bytes';

test('login identifiers are deterministically keyed and purpose separated', () => {
  const first = hashLoginDimension(TEST_SECRET, 'login-identifier', 'marcom.pilot');
  const second = hashLoginDimension(TEST_SECRET, 'login-identifier', 'marcom.pilot');
  const source = hashLoginDimension(TEST_SECRET, 'login-source', 'marcom.pilot');

  assert.equal(first, second);
  assert.notEqual(first, source);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes('marcom.pilot'), false);
});

test('login dimension hashing rejects weak deployment secrets', () => {
  assert.throws(
    () => hashLoginDimension('too-short', 'login-identifier', 'marcom.pilot'),
    /at least 32 bytes/,
  );
});
