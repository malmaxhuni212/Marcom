import assert from 'node:assert/strict';
import test from 'node:test';
import { getRequestSource, validateRequestOrigin } from './http';

test('AUTH-002 accepts only the configured request origin', () => {
  const accepted = new Request('https://pilot.example.test/api/v1/auth/session', {
    headers: { Origin: 'https://pilot.example.test' },
  });
  const rejected = new Request('https://pilot.example.test/api/v1/auth/session', {
    headers: { Origin: 'https://attacker.example.test' },
  });

  assert.equal(validateRequestOrigin(accepted, 'https://pilot.example.test'), true);
  assert.equal(validateRequestOrigin(rejected, 'https://pilot.example.test'), false);
  assert.equal(
    validateRequestOrigin(
      new Request('https://pilot.example.test/api/v1/auth/session'),
      'https://pilot.example.test',
    ),
    false,
  );
});

test('AUTH-002 extracts only the first forwarded request source', () => {
  const request = new Request('https://pilot.example.test/api/v1/auth/session', {
    headers: { 'X-Forwarded-For': '203.0.113.10, 10.0.0.1' },
  });
  assert.equal(getRequestSource(request), '203.0.113.10');
});

