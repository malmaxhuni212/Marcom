import { z } from 'zod';

const DatabaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  NETLIFY_DB_URL: z.string().url().optional(),
});

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
