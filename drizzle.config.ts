import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL ?? process.env.NETLIFY_DB_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL or NETLIFY_DB_URL is required for database commands.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: connectionString,
  },
  strict: true,
  verbose: true,
});
