import assert from 'node:assert/strict';
import test from 'node:test';
import { getAccessConfiguration, isLoopbackHostname } from './access-config';

test('AUTH-003 defaults to local only during unhosted development', () => {
  assert.deepEqual(getAccessConfiguration({ NODE_ENV: 'development' }), { mode: 'local' });
  assert.throws(() => getAccessConfiguration({ NODE_ENV: 'production' }));
  assert.throws(() => getAccessConfiguration({ NODE_ENV: 'development', NETLIFY: 'true' }));
});

test('AUTH-003 rejects local mode in production and hosted environments', () => {
  assert.throws(() => getAccessConfiguration({ APP_ACCESS_MODE: 'local', NODE_ENV: 'production' }));
  assert.throws(() => getAccessConfiguration({ APP_ACCESS_MODE: 'local', NETLIFY: 'true' }));
  assert.deepEqual(
    getAccessConfiguration({ APP_ACCESS_MODE: 'shared', NODE_ENV: 'production' }),
    { mode: 'shared' },
  );
});

test('AUTH-003 recognises only loopback hostnames for local access', () => {
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('[::1]'), true);
  assert.equal(isLoopbackHostname('192.168.1.20'), false);
  assert.equal(isLoopbackHostname('pilot.example.test'), false);
});
