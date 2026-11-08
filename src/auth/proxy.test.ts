import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

const SECRET = 'test-auth-secret-with-at-least-32-bytes';

async function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => void | Promise<void>,
): Promise<void> {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('AUTH-003 proxy allows public MARCOM workspace pages in guest mode without redirecting to /login', async () => {
  await withEnvironment(
    {
      APP_ACCESS_MODE: 'shared',
      APP_ORIGIN: 'https://pilot.example.test',
      AUTH_SECRET: SECRET,
      NETLIFY: undefined,
      CONTEXT: undefined,
    },
    () => {
      assert.equal(proxy(new NextRequest('https://pilot.example.test/')).status, 200);
      assert.equal(proxy(new NextRequest('https://pilot.example.test/projects?view=active')).status, 200);
      assert.equal(proxy(new NextRequest('https://pilot.example.test/prospects')).status, 200);
    },
  );
});

test('AUTH-003 proxy rejects an unauthenticated internal team API without redirecting', async () => {
  await withEnvironment(
    {
      APP_ACCESS_MODE: 'shared',
      APP_ORIGIN: 'https://pilot.example.test',
      AUTH_SECRET: SECRET,
      NETLIFY: undefined,
      CONTEXT: undefined,
    },
    () => {
      const response = proxy(new NextRequest('https://pilot.example.test/api/projects'));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('content-type'), 'application/problem+json');
    },
  );
});

test('AUTH-003 proxy allows login, bootstrap, and guest API entry points while keeping team APIs protected', async () => {
  await withEnvironment(
    {
      APP_ACCESS_MODE: 'shared',
      APP_ORIGIN: 'https://pilot.example.test',
      AUTH_SECRET: SECRET,
      NETLIFY: undefined,
      CONTEXT: undefined,
    },
    () => {
      assert.equal(proxy(new NextRequest('https://pilot.example.test/login')).status, 200);
      assert.equal(proxy(new NextRequest('https://pilot.example.test/bootstrap')).status, 200);
      assert.equal(
        proxy(new NextRequest('https://pilot.example.test/api/v1/auth/session')).status,
        200,
      );
      assert.equal(
        proxy(
          new NextRequest('https://pilot.example.test/api/internal/v1/auth/bootstrap'),
        ).status,
        200,
      );
      assert.equal(
        proxy(new NextRequest('https://pilot.example.test/api/v1/guest/quota')).status,
        200,
      );
      assert.equal(
        proxy(new NextRequest('https://pilot.example.test/api/v1/guest/research')).status,
        200,
      );
      assert.equal(
        proxy(new NextRequest('https://pilot.example.test/api/v1/guest/personalization')).status,
        200,
      );
    },
  );
});
