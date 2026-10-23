import { and, eq } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from './client';
import { isDatabaseConfigured } from './env';
import { users, workspaceMemberships, workspaces } from './schema';

export const LOCAL_WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
export const LOCAL_USER_ID = '10000000-0000-4000-8000-000000000002';
export const LOCAL_MEMBERSHIP_ID = '10000000-0000-4000-8000-000000000003';

export interface ActorContext {
  workspaceId: string;
  userId: string;
  membershipId: string;
}

export type LocalPilotActor = ActorContext;

export function getLocalPilotActor(): ActorContext {
  return {
    workspaceId: LOCAL_WORKSPACE_ID,
    userId: LOCAL_USER_ID,
    membershipId: LOCAL_MEMBERSHIP_ID,
  };
}

export async function resolveLocalPilotActor(
  database?: MarcomDatabase,
): Promise<ActorContext> {
  if (!isDatabaseConfigured()) {
    return getLocalPilotActor();
  }

  try {
    const db = database ?? getDatabase();
    const [actor] = await db
      .select({
        workspaceId: workspaces.id,
        userId: users.id,
        membershipId: workspaceMemberships.id,
      })
      .from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
      .innerJoin(users, eq(users.id, workspaceMemberships.userId))
      .where(
        and(
          eq(workspaces.id, LOCAL_WORKSPACE_ID),
          eq(users.id, LOCAL_USER_ID),
          eq(workspaceMemberships.id, LOCAL_MEMBERSHIP_ID),
          eq(workspaces.status, 'active'),
          eq(users.status, 'active'),
          eq(workspaceMemberships.status, 'active'),
        ),
      )
      .limit(1);

    if (!actor) {
      throw new Error('The LocalPilotActor seed is missing or inactive. Run npm run db:seed.');
    }

    return actor;
  } catch (error) {
    console.warn('Database error in resolveLocalPilotActor, falling back to static local actor.', error);
    return getLocalPilotActor();
  }
}
