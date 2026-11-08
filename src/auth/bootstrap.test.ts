import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  BOOTSTRAP_TOKEN_HEADER,
  getAuthBootstrapConfiguration,
  verifyBootstrapSecret,
} from './bootstrap';

const SECRET = `bootstrap-test-secret-${crypto.randomBytes(16).toString('hex')}`;

test('AUTH-001 enables bootstrap only in shared mode with a strong secret', () => {
  assert.deepEqual(
    getAuthBootstrapConfiguration({
      APP_ACCESS_MODE: 'shared',
      AUTH_BOOTSTRAP_SECRET: SECRET,
    }),
    { secret: SECRET },
  );
  assert.equal(
    getAuthBootstrapConfiguration({
      APP_ACCESS_MODE: 'local',
      AUTH_BOOTSTRAP_SECRET: SECRET,
    }),
    null,
  );
  assert.equal(
    getAuthBootstrapConfiguration({
      APP_ACCESS_MODE: 'shared',
      AUTH_BOOTSTRAP_SECRET: 'too-short',
    }),
    null,
  );
});

test('AUTH-001 compares the bootstrap secret without accepting partial values', () => {
  assert.equal(verifyBootstrapSecret(SECRET, SECRET), true);
  assert.equal(verifyBootstrapSecret(SECRET, `${SECRET}-wrong`), false);
  assert.equal(verifyBootstrapSecret(SECRET, null), false);
});

test('AUTH-001 remote bootstrap conceals a disabled or invalid setup token', async () => {
  const previousMode = process.env.APP_ACCESS_MODE;
  const previousSecret = process.env.AUTH_BOOTSTRAP_SECRET;
  try {
    process.env.APP_ACCESS_MODE = 'shared';
    process.env.AUTH_BOOTSTRAP_SECRET = SECRET;
    const route = await import('@/app/api/internal/v1/auth/bootstrap/route');
    const response = await route.POST(
      new Request('https://pilot.example.test/api/internal/v1/auth/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [BOOTSTRAP_TOKEN_HEADER]: 'incorrect-bootstrap-token-with-at-least-32-bytes',
        },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(response.status, 404);
  } finally {
    if (previousMode === undefined) delete process.env.APP_ACCESS_MODE;
    else process.env.APP_ACCESS_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.AUTH_BOOTSTRAP_SECRET;
    else process.env.AUTH_BOOTSTRAP_SECRET = previousSecret;
  }
});
