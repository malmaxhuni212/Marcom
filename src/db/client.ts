import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getDatabaseUrl } from './env';
import * as schema from './schema';

export type MarcomDatabase = NodePgDatabase<typeof schema>;

type DatabaseGlobal = typeof globalThis & {
  __marcomDatabase?: MarcomDatabase;
  __marcomPool?: Pool;
};

const databaseGlobal = globalThis as DatabaseGlobal;

export function getDatabasePool(): Pool {
  if (!databaseGlobal.__marcomPool) {
    databaseGlobal.__marcomPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: process.env.NODE_ENV === 'production' ? 10 : 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  return databaseGlobal.__marcomPool;
}

export function getDatabase(): MarcomDatabase {
  if (!databaseGlobal.__marcomDatabase) {
    databaseGlobal.__marcomDatabase = drizzle(getDatabasePool(), { schema });
  }

  return databaseGlobal.__marcomDatabase;
}

export async function closeDatabasePool(): Promise<void> {
  if (databaseGlobal.__marcomPool) {
    await databaseGlobal.__marcomPool.end();
    delete databaseGlobal.__marcomPool;
    delete databaseGlobal.__marcomDatabase;
  }
}
