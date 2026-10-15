import assert from 'node:assert/strict';
import test from 'node:test';
import { hashCsrfToken, hashSessionToken, verifySessionCsrfToken } from './session';

const SECRET = 'test-auth-secret-with-at-least-32-bytes';

test('AUTH-002 domain-separates session and CSRF token hashes', () => {
  const token = 'one-test-token';
  const sessionHash = hashSessionToken(SECRET, token);
  const csrfHash = hashCsrfToken(SECRET, token);

  assert.match(sessionHash, /^[a-f0-9]{64}$/);
  assert.match(csrfHash, /^[a-f0-9]{64}$/);
  assert.notEqual(sessionHash, csrfHash);
});

test('AUTH-002 verifies CSRF tokens without storing the raw value', () => {
  const token = 'csrf-test-token';
  const hash = hashCsrfToken(SECRET, token);

  assert.equal(verifySessionCsrfToken(SECRET, token, hash), true);
  assert.equal(verifySessionCsrfToken(SECRET, 'different-token', hash), false);
  assert.equal(verifySessionCsrfToken(SECRET, '', hash), false);
});

