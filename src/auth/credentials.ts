import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from '@/db/client';
import { LOCAL_WORKSPACE_ID, type ActorContext } from '@/db/local-actor';
import { auditEvents, authSessions, users, workspaceMemberships, workspaces } from '@/db/schema';
import { hashPassword, validateUsername } from './password';

export const SHARED_PILOT_DISPLAY_NAME = 'MARCOM Shared Pilot';

export interface BootstrapSharedPilotInput {
  username: string;
  password: string;
  displayName?: string;
  workspaceId?: string;
}

export interface SharedPilotCredentialStatus {
  actor: ActorContext;
  username: string;
  displayName: string;
  userStatus: string;
  membershipStatus: string;
  credentialVersion: number;
  passwordChangedAt: Date;
  lastLoginAt: Date | null;
  activeSessionCount: number;
}

function internalEmail(userId: string): string {
  return `shared-pilot-${userId}@invalid.local`;
}

export async function bootstrapSharedPilotCredential(
  input: BootstrapSharedPilotInput,
  database: MarcomDatabase = getDatabase(),
): Promise<SharedPilotCredentialStatus> {
  const username = validateUsername(input.username);
  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName?.trim() || SHARED_PILOT_DISPLAY_NAME;
  if (displayName.length > 160) throw new Error('Display name must not exceed 160 characters.');
  const workspaceId = input.workspaceId ?? LOCAL_WORKSPACE_ID;
  const now = new Date();
  const userId = randomUUID();
  const membershipId = randomUUID();

  return database.transaction(async (transaction) => {
    const [workspace] = await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.status, 'active')))
      .limit(1);

    if (!workspace) {
      throw new Error('The target workspace is missing or inactive. Run the database seed first.');
    }

    const [existing] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.usernameNormalized, username))
      .limit(1);

    if (existing) {
      throw new Error('The shared pilot username already exists. Use the password rotation command.');
    }

    await transaction.insert(users).values({
      id: userId,
      email: internalEmail(userId),
      emailNormalized: internalEmail(userId),
      displayName,
      authMethod: 'password',
      usernameNormalized: username,
      passwordHash,
      credentialVersion: 1,
      passwordChangedAt: now,
      status: 'active',
      updatedAt: now,
    });

    await transaction.insert(workspaceMemberships).values({
      id: membershipId,
      workspaceId,
      userId,
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    });

    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId,
      actorType: 'system',
      action: 'auth.shared_pilot_bootstrapped',
      subjectType: 'user',
      subjectId: userId,
      reason: 'Access-gate bootstrap command',
      safeDiff: {
        authMethod: 'password',
        credentialVersion: 1,
      },
    });

    return {
      actor: { workspaceId, userId, membershipId },
      username,
      displayName,
      userStatus: 'active',
      membershipStatus: 'active',
      credentialVersion: 1,
      passwordChangedAt: now,
      lastLoginAt: null,
      activeSessionCount: 0,
    };
  });
}

export async function rotateSharedPilotPassword(
  usernameInput: string,
  newPassword: string,
  database: MarcomDatabase = getDatabase(),
): Promise<SharedPilotCredentialStatus> {
  const username = validateUsername(usernameInput);
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  return database.transaction(async (transaction) => {
    const [identity] = await transaction
      .select({
        workspaceId: workspaceMemberships.workspaceId,
        userId: users.id,
        membershipId: workspaceMemberships.id,
        displayName: users.displayName,
        userStatus: users.status,
        membershipStatus: workspaceMemberships.status,
        credentialVersion: users.credentialVersion,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .innerJoin(workspaceMemberships, eq(workspaceMemberships.userId, users.id))
      .where(
        and(
          eq(users.usernameNormalized, username),
          eq(users.authMethod, 'password'),
          eq(workspaceMemberships.workspaceId, LOCAL_WORKSPACE_ID),
        ),
      )
      .limit(1);

    if (!identity) {
      throw new Error('The shared pilot credential was not found.');
    }

    const nextVersion = identity.credentialVersion + 1;
    await transaction
      .update(users)
      .set({
        passwordHash,
        credentialVersion: nextVersion,
        passwordChangedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, identity.userId));

    const revokedSessions = await transaction
      .update(authSessions)
      .set({
        revokedAt: now,
        revocationReason: 'Password rotated',
      })
      .where(and(eq(authSessions.userId, identity.userId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });

    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: identity.workspaceId,
      actorType: 'system',
      action: 'auth.password_rotated',
      subjectType: 'user',
      subjectId: identity.userId,
      reason: 'Access-gate password rotation command',
      safeDiff: {
        previousCredentialVersion: identity.credentialVersion,
        credentialVersion: nextVersion,
        revokedSessionCount: revokedSessions.length,
      },
    });

    return {
      actor: {
        workspaceId: identity.workspaceId,
        userId: identity.userId,
        membershipId: identity.membershipId,
      },
      username,
      displayName: identity.displayName,
      userStatus: identity.userStatus,
      membershipStatus: identity.membershipStatus,
      credentialVersion: nextVersion,
      passwordChangedAt: now,
      lastLoginAt: identity.lastLoginAt,
      activeSessionCount: 0,
    };
  });
}

export async function getSharedPilotCredentialStatus(
  usernameInput: string,
  database: MarcomDatabase = getDatabase(),
): Promise<SharedPilotCredentialStatus | null> {
  const username = validateUsername(usernameInput);
  const [identity] = await database
    .select({
      workspaceId: workspaceMemberships.workspaceId,
      userId: users.id,
      membershipId: workspaceMemberships.id,
      displayName: users.displayName,
      userStatus: users.status,
      membershipStatus: workspaceMemberships.status,
      credentialVersion: users.credentialVersion,
      passwordChangedAt: users.passwordChangedAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .innerJoin(workspaceMemberships, eq(workspaceMemberships.userId, users.id))
    .where(
      and(
        eq(users.usernameNormalized, username),
        eq(users.authMethod, 'password'),
        eq(workspaceMemberships.workspaceId, LOCAL_WORKSPACE_ID),
      ),
    )
    .limit(1);

  if (!identity?.passwordChangedAt) return null;

  const now = new Date();
  const [sessionCount] = await database
    .select({ value: count() })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.userId, identity.userId),
        isNull(authSessions.revokedAt),
        gt(authSessions.idleExpiresAt, now),
        gt(authSessions.absoluteExpiresAt, now),
      ),
    );

  return {
    actor: {
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      membershipId: identity.membershipId,
    },
    username,
    displayName: identity.displayName,
    userStatus: identity.userStatus,
    membershipStatus: identity.membershipStatus,
    credentialVersion: identity.credentialVersion,
    passwordChangedAt: identity.passwordChangedAt,
    lastLoginAt: identity.lastLoginAt,
    activeSessionCount: sessionCount?.value ?? 0,
  };
}


