import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabasePool, getDatabase } from './client';
import { loadDatabaseEnvironment } from './load-environment';

loadDatabaseEnvironment();

async function main(): Promise<void> {
  await migrate(getDatabase(), { migrationsFolder: 'drizzle' });
  console.log(JSON.stringify({ event: 'database_migration_complete' }));
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'database_migration_failed',
        message: error instanceof Error ? error.message : 'Unknown database migration failure',
      }),
    );
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);
