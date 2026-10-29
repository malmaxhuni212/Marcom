import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getApplicationDatabaseUrl,
  getDatabaseUrl,
  usesNetlifyManagedMigrations,
} from './env';

test('uses DATABASE_URL before the Netlify fallback', () => {
  const result = getDatabaseUrl({
    DATABASE_URL: 'postgresql://primary.example.test/marcom?sslmode=verify-full',
    NETLIFY_DB_URL: 'postgresql://netlify.example.test/marcom?sslmode=verify-full',
  });

  assert.equal(result, 'postgresql://primary.example.test/marcom?sslmode=verify-full');
});

test('uses NETLIFY_DB_URL when DATABASE_URL is absent', () => {
  const result = getDatabaseUrl({
    NETLIFY_DB_URL: 'postgresql://netlify.example.test/marcom?sslmode=verify-full',
  });

  assert.equal(result, 'postgresql://netlify.example.test/marcom?sslmode=verify-full');
});

test('keeps TLS certificate verification explicit for pg compatibility', () => {
  const result = getDatabaseUrl({
    NETLIFY_DB_URL: 'postgresql://netlify.example.test/marcom?sslmode=require',
  });

  assert.equal(result, 'postgresql://netlify.example.test/marcom?sslmode=verify-full');
});

test('rejects a missing database connection string', () => {
  assert.throws(() => getDatabaseUrl({}), /DATABASE_URL or NETLIFY_DB_URL is required/);
});

test('reserves NETLIFY_DB_URL for Netlify-managed migrations', () => {
  assert.equal(
    usesNetlifyManagedMigrations({
      NETLIFY_DB_URL: 'postgresql://netlify.example.test/marcom',
    }),
    true,
  );
});

test('allows manual migrations when an explicit DATABASE_URL is selected', () => {
  assert.equal(
    usesNetlifyManagedMigrations({
      DATABASE_URL: 'postgresql://localhost/marcom',
      NETLIFY_DB_URL: 'postgresql://netlify.example.test/marcom',
    }),
    false,
  );
});

test('uses the branch-aware Netlify runtime connection when deployed', () => {
  let resolved = false;
  const result = getApplicationDatabaseUrl(
    {
      NETLIFY: 'true',
      DATABASE_URL: 'postgresql://local.example.test/marcom',
    },
    () => {
      resolved = true;
      return 'postgresql://runtime.example.test/marcom?sslmode=require';
    },
  );

  assert.equal(resolved, true);
  assert.equal(result, 'postgresql://runtime.example.test/marcom?sslmode=verify-full');
});

test('falls back to explicit DATABASE_URL on Netlify when Netlify DB addon is absent', () => {
  const result = getApplicationDatabaseUrl(
    {
      NETLIFY: 'true',
      DATABASE_URL: 'postgresql://neon.example.test/marcom?sslmode=require',
    },
    () => {
      throw new Error('Netlify database integration is not provisioned.');
    },
  );

  assert.equal(result, 'postgresql://neon.example.test/marcom?sslmode=verify-full');
});

test('does not ask Netlify for a connection outside its runtime', () => {
  const result = getApplicationDatabaseUrl(
    { DATABASE_URL: 'postgresql://local.example.test/marcom' },
    () => {
      throw new Error('Netlify resolver must not run locally.');
    },
  );

  assert.equal(result, 'postgresql://local.example.test/marcom');
});
