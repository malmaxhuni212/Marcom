import assert from 'node:assert/strict';
import test from 'node:test';
import { getDatabaseUrl } from './env';

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
