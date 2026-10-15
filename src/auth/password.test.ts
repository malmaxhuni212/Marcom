import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashPassword,
  normalizeUsername,
  PASSWORD_MAX_LENGTH,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './password';

test('normalizes and validates a shared pilot username', () => {
  assert.equal(normalizeUsername('  MARCOM.Pilot  '), 'marcom.pilot');
  assert.equal(validateUsername('  MARCOM.Pilot  '), 'marcom.pilot');
  assert.throws(() => validateUsername('pilot user'), /lowercase letters/);
});

test('enforces password length without changing password content', () => {
  assert.throws(() => validatePassword('too-short'), /between 16 and 128/);
  assert.throws(() => validatePassword('x'.repeat(PASSWORD_MAX_LENGTH + 1)), /between 16 and 128/);
  assert.doesNotThrow(() => validatePassword('correct horse battery staple'));
});

test('hashes and verifies a password with a unique salt', async () => {
  const password = 'correct horse battery staple';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('incorrect horse battery staple', first), false);
});

test('rejects malformed or unsupported password hashes', async () => {
  assert.equal(await verifyPassword('correct horse battery staple', 'not-a-password-hash'), false);
  assert.equal(
    await verifyPassword(
      'correct horse battery staple',
      'scrypt$v=1$N=16384,r=8,p=1$c2FsdA$aGFzaA',
    ),
    false,
  );
});
