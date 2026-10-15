import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from '@/db/client';
import type { ActorContext } from '@/db/local-actor';
import {
  auditEvents,
  authSessions,
  users,
  workspaceMemberships,
  workspaces,
} from '@/db/schema';

export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

const TOKEN_BYTES = 32;
const MAX_TOKEN_LENGTH = 256;

export interface CreateSessionInput {
  actor: ActorContext;
  displayName: string;
  credentialVersion: number;
  authSecret: string;
  now?: Date;
}

export interface CreatedSession {
  id: string;
  token: string;
  csrfToken: string;
  displayName: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface ValidSession {
  id: string;
  actor: ActorContext;
  displayName: string;
  csrfTokenHash: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

function requireAuthSecret(value: string): string {
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('AUTH_SECRET must contain at least 32 bytes.');
  }
  return value;
}

function hashToken(authSecret: string, purpose: 'session' | 'csrf', token: string): string {
  return createHmac('sha256', requireAuthSecret(authSecret))
    .update(`${purpose}\0${token}`)
    .digest('hex');
}

function createToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function minDate(first: Date, second: Date): Date {
  return first.getTime() <= second.getTime() ? first : second;
}

export function hashSessionToken(authSecret: string, token: string): string {
  return hashToken(authSecret, 'session', token);
}

export function hashCsrfToken(authSecret: string, token: string): string {
  return hashToken(authSecret, 'csrf', token);
}

export function verifySessionCsrfToken(
  authSecret: string,
  candidate: string,
  expectedHash: string,
): boolean {
  if (!candidate || candidate.length > MAX_TOKEN_LENGTH) return false;
  const actual = Buffer.from(hashCsrfToken(authSecret, candidate), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createSession(
  input: CreateSessionInput,
  database: MarcomDatabase = getDatabase(),
): Promise<CreatedSession> {
  const now = input.now ?? new Date();
  const token = createToken();
  const csrfToken = createToken();
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  const idleExpiresAt = minDate(new Date(now.getTime() + SESSION_IDLE_MS), absoluteExpiresAt);
  const id = randomUUID();

  await database.transaction(async (transaction) => {
    await transaction.insert(authSessions).values({
      id,
      workspaceId: input.actor.workspaceId,
      userId: input.actor.userId,
      membershipId: input.actor.membershipId,
      tokenHash: hashSessionToken(input.authSecret, token),
      csrfTokenHash: hashCsrfToken(input.authSecret, csrfToken),
      credentialVersion: input.credentialVersion,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
    });
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: input.actor.workspaceId,
      actorType: 'membership',
      actorMembershipId: input.actor.membershipId,
      action: 'auth.session_created',
      subjectType: 'auth_session',
      subjectId: id,
      safeDiff: {
        credentialVersion: input.credentialVersion,
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      },
    });
  });

  return {
    id,
    token,
    csrfToken,
    displayName: input.displayName,
    idleExpiresAt,
    absoluteExpiresAt,
  };
}

export async function validateSession(
  token: string,
  authSecret: string,
  database: MarcomDatabase = getDatabase(),
  now: Date = new Date(),
): Promise<ValidSession | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const tokenHash = hashSessionToken(authSecret, token);

  const [record] = await database
    .select({
      id: authSessions.id,
      workspaceId: authSessions.workspaceId,
      userId: authSessions.userId,
      membershipId: authSessions.membershipId,
      csrfTokenHash: authSessions.csrfTokenHash,
      credentialVersion: authSessions.credentialVersion,
      lastSeenAt: authSessions.lastSeenAt,
      idleExpiresAt: authSessions.idleExpiresAt,
      absoluteExpiresAt: authSessions.absoluteExpiresAt,
      revokedAt: authSessions.revokedAt,
      displayName: users.displayName,
      currentCredentialVersion: users.credentialVersion,
      userStatus: users.status,
      membershipStatus: workspaceMemberships.status,
      workspaceStatus: workspaces.status,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.id, authSessions.membershipId),
        eq(workspaceMemberships.workspaceId, authSessions.workspaceId),
        eq(workspaceMemberships.userId, authSessions.userId),
      ),
    )
    .innerJoin(workspaces, eq(workspaces.id, authSessions.workspaceId))
    .where(eq(authSessions.tokenHash, tokenHash))
    .limit(1);

  if (
    !record ||
    record.revokedAt ||
    record.idleExpiresAt.getTime() <= now.getTime() ||
    record.absoluteExpiresAt.getTime() <= now.getTime() ||
    record.credentialVersion !== record.currentCredentialVersion ||
    record.userStatus !== 'active' ||
    record.membershipStatus !== 'active' ||
    record.workspaceStatus !== 'active'
  ) {
    return null;
  }

  let idleExpiresAt = record.idleExpiresAt;
  if (now.getTime() - record.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    idleExpiresAt = minDate(new Date(now.getTime() + SESSION_IDLE_MS), record.absoluteExpiresAt);
    await database
      .update(authSessions)
      .set({ lastSeenAt: now, idleExpiresAt })
      .where(and(eq(authSessions.id, record.id), isNull(authSessions.revokedAt)));
  }

  return {
    id: record.id,
    actor: {
      workspaceId: record.workspaceId,
      userId: record.userId,
      membershipId: record.membershipId,
    },
    displayName: record.displayName,
    csrfTokenHash: record.csrfTokenHash,
    idleExpiresAt,
    absoluteExpiresAt: record.absoluteExpiresAt,
  };
}

export async function revokeSession(
  token: string,
  authSecret: string,
  reason: string,
  database: MarcomDatabase = getDatabase(),
  now: Date = new Date(),
): Promise<boolean> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;
  const tokenHash = hashSessionToken(authSecret, token);
  const safeReason = reason.trim().slice(0, 160) || 'Session revoked';

  return database.transaction(async (transaction) => {
    const [record] = await transaction
      .update(authSessions)
      .set({ revokedAt: now, revocationReason: safeReason })
      .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)))
      .returning({
        id: authSessions.id,
        workspaceId: authSessions.workspaceId,
        membershipId: authSessions.membershipId,
      });

    if (!record) return false;

    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: record.workspaceId,
      actorType: 'membership',
      actorMembershipId: record.membershipId,
      action: 'auth.session_revoked',
      subjectType: 'auth_session',
      subjectId: record.id,
      reason: safeReason,
      safeDiff: { revoked: true },
    });
    return true;
  });
}

export async function revokeAllUserSessions(
  userId: string,
  reason: string,
  database: MarcomDatabase = getDatabase(),
  now: Date = new Date(),
): Promise<number> {
  const safeReason = reason.trim().slice(0, 160) || 'Administrator revocation';

  return database.transaction(async (transaction) => {
    const revoked = await transaction
      .update(authSessions)
      .set({ revokedAt: now, revocationReason: safeReason })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id, workspaceId: authSessions.workspaceId });

    if (revoked.length > 0) {
      await transaction.insert(auditEvents).values({
        id: randomUUID(),
        workspaceId: revoked[0].workspaceId,
        actorType: 'system',
        action: 'auth.user_sessions_revoked',
        subjectType: 'user',
        subjectId: userId,
        reason: safeReason,
        safeDiff: { sessionCount: revoked.length },
      });
    }
    return revoked.length;
  });
}

