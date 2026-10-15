import assert from 'node:assert/strict';
import test from 'node:test';
import { getDatabaseUrl, usesNetlifyManagedMigrations } from './env';

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
