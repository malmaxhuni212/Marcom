import { createHmac, randomUUID } from 'node:crypto';
import { and, eq, gte } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from '@/db/client';
import { LOCAL_WORKSPACE_ID, type ActorContext } from '@/db/local-actor';
import { authLoginAttempts, users, workspaceMemberships, workspaces } from '@/db/schema';
import { normalizeUsername, validateUsername, verifyPassword } from './password';

const DUMMY_PASSWORD_HASH =
  'scrypt$v=1$N=32768,r=8,p=3$lHfBYPP24GbC29PByy3TMg$x21M5nd_6NDJ3XTnRB36hBfNETF_29F_GI87jG82g9U';

export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export interface AuthenticatePasswordInput {
  username: string;
  password: string;
  source?: string;
  authSecret: string;
  now?: Date;
}

export type PasswordAuthenticationResult =
  | {
      status: 'authenticated';
      actor: ActorContext;
      displayName: string;
      credentialVersion: number;
    }
  | { status: 'invalid' }
  | { status: 'throttled'; retryAfterSeconds: number };

function requireAuthSecret(value: string): string {
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('AUTH_SECRET must contain at least 32 bytes.');
  }
  return value;
}

export function hashLoginDimension(authSecret: string, purpose: string, value: string): string {
  return createHmac('sha256', requireAuthSecret(authSecret))
    .update(`${purpose}\0${value}`)
    .digest('hex');
}

export async function authenticatePasswordCredential(
  input: AuthenticatePasswordInput,
  database: MarcomDatabase = getDatabase(),
): Promise<PasswordAuthenticationResult> {
  const now = input.now ?? new Date();
  const normalizedCandidate = normalizeUsername(input.username);
  const identifierHash = hashLoginDimension(input.authSecret, 'login-identifier', normalizedCandidate);
  const sourceHash = input.source
    ? hashLoginDimension(input.authSecret, 'login-source', input.source)
    : null;
  const attemptWindowStart = new Date(now.getTime() - LOGIN_ATTEMPT_WINDOW_MS);

  const recentFailures = await database
    .select({ attemptedAt: authLoginAttempts.attemptedAt })
    .from(authLoginAttempts)
    .where(
      and(
        eq(authLoginAttempts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(authLoginAttempts.identifierHash, identifierHash),
        eq(authLoginAttempts.succeeded, false),
        gte(authLoginAttempts.attemptedAt, attemptWindowStart),
      ),
    )
    .orderBy(authLoginAttempts.attemptedAt);

  if (recentFailures.length >= LOGIN_ATTEMPT_LIMIT) {
    const oldestActiveFailure = recentFailures[0]?.attemptedAt ?? now;
    const retryAt = oldestActiveFailure.getTime() + LOGIN_ATTEMPT_WINDOW_MS;
    return {
      status: 'throttled',
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000)),
    };
  }

  let username: string | null = null;
  try {
    username = validateUsername(input.username);
  } catch {
    username = null;
  }

  const [identity] = username
    ? await database
        .select({
          workspaceId: workspaceMemberships.workspaceId,
          userId: users.id,
          membershipId: workspaceMemberships.id,
          displayName: users.displayName,
          credentialVersion: users.credentialVersion,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .innerJoin(workspaceMemberships, eq(workspaceMemberships.userId, users.id))
        .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
        .where(
          and(
            eq(users.usernameNormalized, username),
            eq(users.authMethod, 'password'),
            eq(users.status, 'active'),
            eq(workspaceMemberships.workspaceId, LOCAL_WORKSPACE_ID),
            eq(workspaceMemberships.status, 'active'),
            eq(workspaces.status, 'active'),
          ),
        )
        .limit(1)
    : [];

  const passwordMatches = await verifyPassword(
    input.password,
    identity?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  const succeeded = Boolean(identity?.passwordHash && passwordMatches);

  if (!identity || !succeeded) {
    await database.insert(authLoginAttempts).values({
      id: randomUUID(),
      workspaceId: LOCAL_WORKSPACE_ID,
      identifierHash,
      sourceHash,
      succeeded: false,
      attemptedAt: now,
    });
    return { status: 'invalid' };
  }

  await database.transaction(async (transaction) => {
    await transaction
      .delete(authLoginAttempts)
      .where(
        and(
          eq(authLoginAttempts.workspaceId, LOCAL_WORKSPACE_ID),
          eq(authLoginAttempts.identifierHash, identifierHash),
          eq(authLoginAttempts.succeeded, false),
        ),
      );

    await transaction.insert(authLoginAttempts).values({
      id: randomUUID(),
      workspaceId: LOCAL_WORKSPACE_ID,
      identifierHash,
      sourceHash,
      succeeded: true,
      attemptedAt: now,
    });

    await transaction
      .update(users)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, identity.userId));
  });

  return {
    status: 'authenticated',
    actor: {
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      membershipId: identity.membershipId,
    },
    displayName: identity.displayName,
    credentialVersion: identity.credentialVersion,
  };
}

