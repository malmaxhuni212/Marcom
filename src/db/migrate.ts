import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabasePool, getDatabase } from './client';
import { usesNetlifyManagedMigrations } from './env';
import { loadDatabaseEnvironment } from './load-environment';

loadDatabaseEnvironment();

async function main(): Promise<void> {
  if (usesNetlifyManagedMigrations()) {
    throw new Error(
      'Netlify applies migrations during deploy from netlify/database/migrations. Use db:migrate only with DATABASE_URL for local or self-hosted PostgreSQL.',
    );
  }

  await migrate(getDatabase(), { migrationsFolder: 'netlify/database/migrations' });
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
