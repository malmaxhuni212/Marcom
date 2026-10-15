import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuthConfiguration } from './config';
import { getAuthCookieConfiguration } from './cookies';

const SECRET = 'test-auth-secret-with-at-least-32-bytes';

test('AUTH-002 normalises an allowed application origin', () => {
  const configuration = getAuthConfiguration({
    AUTH_SECRET: SECRET,
    APP_ORIGIN: 'https://pilot.example.test/',
  });

  assert.equal(configuration.appOrigin, 'https://pilot.example.test');
  assert.equal(configuration.secureCookies, true);
});

test('AUTH-002 rejects an origin with a path or credentials', () => {
  assert.throws(() =>
    getAuthConfiguration({
      AUTH_SECRET: SECRET,
      APP_ORIGIN: 'https://pilot.example.test/login',
    }),
  );
  assert.throws(() =>
    getAuthConfiguration({
      AUTH_SECRET: SECRET,
      APP_ORIGIN: 'https://user:password@pilot.example.test',
    }),
  );
});

test('AUTH-002 uses __Host cookies only for HTTPS', () => {
  assert.deepEqual(getAuthCookieConfiguration(true), {
    sessionName: '__Host-marcom_session',
    csrfName: '__Host-marcom_csrf',
    secure: true,
  });
  assert.deepEqual(getAuthCookieConfiguration(false), {
    sessionName: 'marcom_session',
    csrfName: 'marcom_csrf',
    secure: false,
  });
});

