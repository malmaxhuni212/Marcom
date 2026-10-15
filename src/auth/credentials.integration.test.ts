import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { authenticatePasswordCredential, hashLoginDimension } from './authenticate';
import {
  bootstrapSharedPilotCredential,
  getSharedPilotCredentialStatus,
  rotateSharedPilotPassword,
} from './credentials';
import { verifyPassword } from './password';
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
  SESSION_ABSOLUTE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  validateSession,
  verifySessionCsrfToken,
} from './session';
import { LOCAL_WORKSPACE_ID } from '@/db/local-actor';
import { closeDatabasePool } from '@/db/client';
import {
  auditEvents,
  authLoginAttempts,
  authSessions,
  users,
  workspaceMemberships,
  workspaces,
} from '@/db/schema';
import * as schema from '@/db/schema';

const TEST_DATABASE_URL = process.env.AUTH_INTEGRATION_DATABASE_URL;
const TEST_AUTH_SECRET = 'integration-test-auth-secret-with-at-least-32-bytes';

test(
  'AUTH-001 through AUTH-003 complete the credential, session and API-access lifecycle',
  { skip: !TEST_DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    const database = drizzle(pool, { schema });
    const username = `pilot-${randomUUID().slice(0, 8)}`;
    const originalPassword = 'original integration password';
    const rotatedPassword = 'rotated integration password';
    const identifierHash = hashLoginDimension(TEST_AUTH_SECRET, 'login-identifier', username);
    let userId: string | null = null;
    let migrationReady = false;

    try {
      await migrate(database, { migrationsFolder: 'netlify/database/migrations' });
      migrationReady = true;
      await database
        .insert(workspaces)
        .values({
          id: LOCAL_WORKSPACE_ID,
          name: 'MARCOM Authentication Integration Test',
          slug: 'marcom-auth-integration-test',
          status: 'active',
          defaultTimezone: 'Europe/London',
        })
        .onConflictDoNothing();

      const created = await bootstrapSharedPilotCredential(
        { username, password: originalPassword, workspaceId: LOCAL_WORKSPACE_ID },
        database,
      );
      userId = created.actor.userId;

      const [stored] = await database
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, created.actor.userId))
        .limit(1);

      assert.ok(stored?.passwordHash);
      assert.equal(stored.passwordHash.includes(originalPassword), false);
      assert.equal(await verifyPassword(originalPassword, stored.passwordHash), true);

      const invalid = await authenticatePasswordCredential(
        {
          username,
          password: 'incorrect integration password',
          source: 'integration-test',
          authSecret: TEST_AUTH_SECRET,
        },
        database,
      );
      assert.equal(invalid.status, 'invalid');

      const authenticated = await authenticatePasswordCredential(
        {
          username,
          password: originalPassword,
          source: 'integration-test',
          authSecret: TEST_AUTH_SECRET,
        },
        database,
      );
      assert.equal(authenticated.status, 'authenticated');
      assert.ok(authenticated.status === 'authenticated');

      const sessionStart = new Date('2026-10-15T09:00:00.000Z');
      const firstSession = await createSession(
        {
          actor: authenticated.actor,
          displayName: authenticated.displayName,
          credentialVersion: authenticated.credentialVersion,
          authSecret: TEST_AUTH_SECRET,
          now: sessionStart,
        },
        database,
      );
      assert.equal(
        verifySessionCsrfToken(
          TEST_AUTH_SECRET,
          firstSession.csrfToken,
          (await validateSession(firstSession.token, TEST_AUTH_SECRET, database, sessionStart))!
            .csrfTokenHash,
        ),
        true,
      );

      const touchedSession = await validateSession(
        firstSession.token,
        TEST_AUTH_SECRET,
        database,
        new Date(sessionStart.getTime() + SESSION_TOUCH_INTERVAL_MS + 1),
      );
      assert.ok(touchedSession);
      assert.ok(touchedSession.idleExpiresAt.getTime() > firstSession.idleExpiresAt.getTime());

      assert.equal(
        await revokeSession(
          firstSession.token,
          TEST_AUTH_SECRET,
          'Integration test logout',
          database,
        ),
        true,
      );
      assert.equal(
        await validateSession(firstSession.token, TEST_AUTH_SECRET, database, sessionStart),
        null,
      );

      process.env.DATABASE_URL = TEST_DATABASE_URL;
      process.env.AUTH_SECRET = TEST_AUTH_SECRET;
      process.env.APP_ORIGIN = 'http://127.0.0.1:3000';
      process.env.APP_ACCESS_MODE = 'shared';
      const sessionRoute = await import('@/app/api/v1/auth/session/route');
      const loginResponse = await sessionRoute.POST(
        new Request('http://127.0.0.1:3000/api/v1/auth/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:3000',
          },
          body: JSON.stringify({ username, password: originalPassword }),
        }),
      );
      assert.equal(loginResponse.status, 201);
      const routeSessionToken = loginResponse.cookies.get('marcom_session')?.value;
      const routeCsrfToken = loginResponse.cookies.get('marcom_csrf')?.value;
      assert.ok(routeSessionToken);
      assert.ok(routeCsrfToken);
      const setCookieHeader = loginResponse.headers.get('set-cookie') ?? '';
      assert.match(setCookieHeader, /marcom_session=.*HttpOnly/i);
      assert.match(setCookieHeader, /SameSite=lax/i);

      const routeCookies = `marcom_session=${routeSessionToken}; marcom_csrf=${routeCsrfToken}`;
      const { authorizeApiRequest } = await import('./access');
      const missingSessionAccess = await authorizeApiRequest(
        new Request('http://127.0.0.1:3000/api/projects'),
      );
      assert.equal(missingSessionAccess.ok, false);
      if (!missingSessionAccess.ok) assert.equal(missingSessionAccess.response.status, 401);

      const validSessionAccess = await authorizeApiRequest(
        new Request('http://127.0.0.1:3000/api/projects', { headers: { Cookie: routeCookies } }),
      );
      assert.equal(validSessionAccess.ok, true);
      if (validSessionAccess.ok) {
        assert.deepEqual(validSessionAccess.actor, authenticated.actor);
        assert.equal(validSessionAccess.allowFileFallback, false);
      }

      const missingCsrfAccess = await authorizeApiRequest(
        new Request('http://127.0.0.1:3000/api/projects', {
          method: 'DELETE',
          headers: { Cookie: routeCookies, Origin: 'http://127.0.0.1:3000' },
        }),
      );
      assert.equal(missingCsrfAccess.ok, false);
      if (!missingCsrfAccess.ok) assert.equal(missingCsrfAccess.response.status, 403);

      const validMutationAccess = await authorizeApiRequest(
        new Request('http://127.0.0.1:3000/api/projects', {
          method: 'DELETE',
          headers: {
            Cookie: routeCookies,
            Origin: 'http://127.0.0.1:3000',
            'X-CSRF-Token': routeCsrfToken,
          },
        }),
      );
      assert.equal(validMutationAccess.ok, true);

      const currentSessionResponse = await sessionRoute.GET(
        new Request('http://127.0.0.1:3000/api/v1/auth/session', {
          headers: { Cookie: routeCookies },
        }),
      );
      assert.equal(currentSessionResponse.status, 200);

      const projectsRoute = await import('@/app/api/projects/route');
      assert.equal(
        (await projectsRoute.GET(new Request('http://127.0.0.1:3000/api/projects'))).status,
        401,
      );
      const authenticatedProjectsResponse = await projectsRoute.GET(
        new Request('http://127.0.0.1:3000/api/projects', {
          headers: { Cookie: routeCookies },
        }),
      );
      assert.equal(authenticatedProjectsResponse.status, 200);

      const rejectedLogoutResponse = await sessionRoute.DELETE(
        new Request('http://127.0.0.1:3000/api/v1/auth/session', {
          method: 'DELETE',
          headers: {
            Cookie: routeCookies,
            Origin: 'http://127.0.0.1:3000',
          },
        }),
      );
      assert.equal(rejectedLogoutResponse.status, 403);

      const logoutResponse = await sessionRoute.DELETE(
        new Request('http://127.0.0.1:3000/api/v1/auth/session', {
          method: 'DELETE',
          headers: {
            Cookie: routeCookies,
            Origin: 'http://127.0.0.1:3000',
            'X-CSRF-Token': routeCsrfToken,
          },
        }),
      );
      assert.equal(logoutResponse.status, 204);
      assert.equal(
        (
          await sessionRoute.GET(
            new Request('http://127.0.0.1:3000/api/v1/auth/session', {
              headers: { Cookie: routeCookies },
            }),
          )
        ).status,
        401,
      );

      const secondSession = await createSession(
        {
          actor: authenticated.actor,
          displayName: authenticated.displayName,
          credentialVersion: authenticated.credentialVersion,
          authSecret: TEST_AUTH_SECRET,
          now: sessionStart,
        },
        database,
      );
      assert.equal(
        await validateSession(
          secondSession.token,
          TEST_AUTH_SECRET,
          database,
          new Date(sessionStart.getTime() + SESSION_ABSOLUTE_MS + 1),
        ),
        null,
      );
      assert.equal(
        await revokeAllUserSessions(
          authenticated.actor.userId,
          'Integration test administrator revocation',
          database,
          sessionStart,
        ),
        1,
      );
      assert.equal(
        await validateSession(secondSession.token, TEST_AUTH_SECRET, database, sessionStart),
        null,
      );

      const thirdSession = await createSession(
        {
          actor: authenticated.actor,
          displayName: authenticated.displayName,
          credentialVersion: authenticated.credentialVersion,
          authSecret: TEST_AUTH_SECRET,
          now: sessionStart,
        },
        database,
      );

      const rotated = await rotateSharedPilotPassword(username, rotatedPassword, database);
      assert.equal(rotated.credentialVersion, 2);
      assert.equal(
        await validateSession(thirdSession.token, TEST_AUTH_SECRET, database, sessionStart),
        null,
      );

      const status = await getSharedPilotCredentialStatus(username, database);
      assert.equal(status?.credentialVersion, 2);

      const oldPassword = await authenticatePasswordCredential(
        {
          username,
          password: originalPassword,
          source: 'integration-test',
          authSecret: TEST_AUTH_SECRET,
        },
        database,
      );
      assert.equal(oldPassword.status, 'invalid');

      const newPassword = await authenticatePasswordCredential(
        {
          username,
          password: rotatedPassword,
          source: 'integration-test',
          authSecret: TEST_AUTH_SECRET,
        },
        database,
      );
      assert.equal(newPassword.status, 'authenticated');
    } finally {
      await closeDatabasePool();
      delete process.env.DATABASE_URL;
      delete process.env.AUTH_SECRET;
      delete process.env.APP_ORIGIN;
      delete process.env.APP_ACCESS_MODE;
      if (migrationReady) {
        await database.delete(auditEvents).where(eq(auditEvents.workspaceId, LOCAL_WORKSPACE_ID));
        await database
          .delete(authLoginAttempts)
          .where(eq(authLoginAttempts.identifierHash, identifierHash));
        if (userId) {
          await database.delete(authSessions).where(eq(authSessions.userId, userId));
          await database.delete(workspaceMemberships).where(eq(workspaceMemberships.userId, userId));
          await database.delete(users).where(eq(users.id, userId));
        }
      }
      await pool.end();
    }
  },
);
