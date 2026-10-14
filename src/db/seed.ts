import { getDatabase, closeDatabasePool } from './client';
import { loadDatabaseEnvironment } from './load-environment';
import { LOCAL_MEMBERSHIP_ID, LOCAL_USER_ID, LOCAL_WORKSPACE_ID } from './local-actor';
import { users, workspaceMemberships, workspaces } from './schema';

loadDatabaseEnvironment();

async function main(): Promise<void> {
  const database = getDatabase();

  await database.transaction(async (transaction) => {
    await transaction
      .insert(workspaces)
      .values({
        id: LOCAL_WORKSPACE_ID,
        name: 'MARCOM Local Pilot',
        slug: 'marcom-local-pilot',
        status: 'active',
        defaultTimezone: 'Europe/London',
      })
      .onConflictDoNothing();

    await transaction
      .insert(users)
      .values({
        id: LOCAL_USER_ID,
        email: 'local-pilot@invalid.local',
        emailNormalized: 'local-pilot@invalid.local',
        displayName: 'Local Pilot User',
        authMethod: 'local_actor',
        status: 'active',
      })
      .onConflictDoNothing();

    await transaction
      .insert(workspaceMemberships)
      .values({
        id: LOCAL_MEMBERSHIP_ID,
        workspaceId: LOCAL_WORKSPACE_ID,
        userId: LOCAL_USER_ID,
        status: 'active',
        joinedAt: new Date(),
      })
      .onConflictDoNothing();
  });

  console.log(
    JSON.stringify({
      event: 'database_seed_complete',
      workspaceId: LOCAL_WORKSPACE_ID,
      membershipId: LOCAL_MEMBERSHIP_ID,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'database_seed_failed',
        message: error instanceof Error ? error.message : 'Unknown database seed failure',
      }),
    );
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);
