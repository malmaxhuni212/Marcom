import { getConnectionString as getNetlifyConnectionString } from '@netlify/database';
import { z } from 'zod';

const DatabaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  NETLIFY_DB_URL: z.string().url().optional(),
});

const DB_COOLDOWN_MS = 60_000;
type DbEnvGlobal = typeof globalThis & {
  __marcomDbUnavailableUntil?: number;
};
const dbEnvGlobal = globalThis as DbEnvGlobal;

export function markDatabaseTemporarilyUnavailable(): void {
  dbEnvGlobal.__marcomDbUnavailableUntil = Date.now() + DB_COOLDOWN_MS;
}

export function isDatabaseConfigured(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (
    environment === process.env &&
    (dbEnvGlobal.__marcomDbUnavailableUntil ?? 0) > Date.now()
  ) {
    return false;
  }
  const parsed = DatabaseEnvironmentSchema.safeParse(environment);
  if (!parsed.success) return false;
  return Boolean(parsed.data.DATABASE_URL || parsed.data.NETLIFY_DB_URL);
}

export function getDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const parsed = DatabaseEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error('The database connection configuration is invalid.');
  }

  const connectionString = parsed.data.DATABASE_URL ?? parsed.data.NETLIFY_DB_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL or NETLIFY_DB_URL is required.');
  }

  const url = new URL(connectionString);
  const sslMode = url.searchParams.get('sslmode');
  if (sslMode === 'prefer' || sslMode === 'require' || sslMode === 'verify-ca') {
    url.searchParams.set('sslmode', 'verify-full');
  }

  return url.toString();
}

function isEnabledFlag(value: string | undefined): boolean {
  return Boolean(value && !['0', 'false', 'no'].includes(value.toLowerCase()));
}

export function getApplicationDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
  resolveNetlifyConnection: () => string = getNetlifyConnectionString,
): string {
  if (isEnabledFlag(environment.NETLIFY)) {
    try {
      const runtimeConnection = resolveNetlifyConnection();
      if (runtimeConnection) {
        return getDatabaseUrl({ NETLIFY_DB_URL: runtimeConnection });
      }
    } catch (error) {
      if (environment.DATABASE_URL || environment.NETLIFY_DB_URL) {
        return getDatabaseUrl(environment);
      }
      throw error;
    }
  }

  return getDatabaseUrl(environment);
}

export function usesNetlifyManagedMigrations(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return !environment.DATABASE_URL && Boolean(environment.NETLIFY_DB_URL);
}
