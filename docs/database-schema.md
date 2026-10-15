# Database schema guide

This guide is the entry point for developers and coding agents working on MARCOM persistence. It covers backlog tasks DB-001, DB-002 and DB-003 at a practical level. The executable schema remains in code and migrations.

## Sources of truth

Use these sources in this order:

1. `src/db/schema/*.ts` defines the intended PostgreSQL tables, columns, foreign keys, checks and indexes.
2. `netlify/database/migrations/*.sql` defines the reviewed migration path used by Netlify, shared and local databases.
3. Repository and server-store code under `src/db/` and `src/marcom/memory/server-store.ts` defines how application workflows read and write the tables.
4. This document explains ownership, relationships and change rules that may not be obvious from individual files.

The live Netlify database contains applied runtime state. It is not a substitute for committed schema and migration files. A fresh database must be reproducible from this repository.

## Current persistence boundary

PostgreSQL is authoritative for:

- the local pilot workspace, user and membership;
- shared-pilot usernames, password hashes, credential versions and login-attempt records after `AUTH-001`;
- revocable, expiring, session-bound CSRF records after `AUTH-002`;
- campaigns and campaign briefs;
- campaign configuration versions and configurable prospect fields;
- search-plan versions;
- message-template version definitions;
- jobs, job items and research runs;
- raw research results;
- canonical prospects, identifiers and contact points;
- campaign-specific prospect state and human review decisions;
- evidence and provider-operation provenance;
- duplicate candidates, idempotency records and audit events.

Personalisation output is still stored in JSON files under `memory/personalization/`. That is a temporary boundary, not a second source of truth for campaigns or research. Do not extend JSON storage to new database-owned features.

The old campaign and research JSON files are retained only as recovery and import inputs. Import commands do not delete them.

## Table groups

| Area | Tables | Purpose |
| --- | --- | --- |
| Identity | `workspaces`, `users`, `workspace_memberships`, `auth_login_attempts`, `auth_sessions` | Provides the local actor, shared-pilot credentials and secure server-side sessions. Product route enforcement remains `AUTH-003` work. |
| Campaign | `campaigns`, `stored_files`, `campaign_briefs` | Stores versioned campaign input and file metadata. Original file bytes remain in the configured protected file store. |
| Configuration | `campaign_config_versions`, `campaign_field_definitions`, `search_plan_versions`, `message_template_versions` | Stores editable and approved versions used by human gates and later processing. |
| Research queue | `jobs`, `job_items`, `research_runs` | Tracks bounded work, retries, progress and terminal status. |
| Prospect data | `prospects`, `prospect_identifiers`, `contact_points`, `campaign_prospects`, `duplicate_candidates` | Separates a canonical person or organisation from its campaign-specific review and engagement state. |
| Evidence and provenance | `research_results`, `evidence_items`, `provider_operations` | Preserves raw search results, evidence for facts, provider identity, usage and cost data. |
| Control | `idempotency_records`, `audit_events` | Prevents duplicate command effects and records material state changes. |

## Important relationships and invariants

- The local pilot actor remains separate from the shared pilot password identity.
- Password users require a normalised username, a password hash, a positive credential version and a password-change timestamp.
- Login-attempt records contain keyed identifiers rather than submitted usernames, passwords or raw network addresses.
- Session and CSRF tokens are stored only as keyed hashes. Sessions carry idle expiry, absolute expiry, revocation state and the credential version that created them.
- Every campaign belongs to one workspace.
- `stored_files` is the workspace-scoped metadata authority for uploaded briefs. Its generated `storage_key` identifies either the protected local store or a Netlify Blobs site-wide store; file bytes never live in PostgreSQL.
- A Netlify deployment selects Netlify Blobs automatically. Non-Netlify development selects `storage/brief-sources`, which remains outside Git and the public web root.
- Uploaded campaign briefs reference `stored_files.id`. Download requests first resolve the authenticated workspace-scoped database record and never accept a raw storage key from the browser.
- A canonical `prospect` may appear in several campaigns, but each campaign can link to that prospect only once through `campaign_prospects`.
- Human review state belongs to `campaign_prospects`, not to the canonical `prospects` row.
- A research run is tied to one job, one campaign and one search-plan version.
- A research result keeps the vendor result and may link to the canonical prospect and campaign prospect created from it.
- Evidence belongs to a campaign prospect and keeps its source URL, retrieval time, confidence and provider provenance.
- Contact values are copied from evidence, normalised for comparison and protected with a deterministic hash. Do not invent contact details.
- Approved configuration and search-plan versions must not be overwritten. A material change creates another version.
- Workspace scope, uniqueness, allowed statuses and other enforceable invariants belong in PostgreSQL constraints as well as application validation.
- Material writes that require audit, approval or idempotency must use one transaction.

## Making a schema change

1. Identify the owning workflow and existing table group.
2. Update the appropriate file under `src/db/schema/`.
3. Run `npm run db:generate`.
4. Review the generated SQL. Do not accept destructive SQL without a data and rollback plan.
5. Add or update repository logic and runtime validation.
6. Add the narrowest useful database or application regression test.
7. For local or self-hosted PostgreSQL, apply the migration with `npm run db:migrate`. For Netlify Database, open a deploy preview and let Netlify apply it to the preview database branch.
8. Verify connectivity, migration status and expected records. Use `npm run db:check` for a writable local database and `netlify database status --branch production` for Netlify.
9. Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`.

Never edit an existing migration after it has been applied to a shared database. Create the next migration instead. The application must not mutate the schema automatically at startup. Netlify production migrations are applied during a production deploy, before the deploy is published. A failed migration prevents that deploy from being published.

## Setup and operational commands

```powershell
npm run db:migrate
npm run db:seed
npm run db:check
npm run auth:bootstrap
npm run auth:rotate-password
npm run auth:revoke-sessions
npm run auth:status
```

`npm run db:migrate` is only for a local or self-hosted PostgreSQL instance selected through `DATABASE_URL`. It deliberately refuses a `NETLIFY_DB_URL`. Netlify discovers committed SQL files in `netlify/database/migrations/` and applies pending migrations during deploy. Drizzle metadata remains in the `meta/` subdirectory so `npm run db:generate` can create the next reviewed migration.

The authentication commands require an explicit database connection. `auth:bootstrap` is a one-time shared-pilot identity operation. Later password changes must use `auth:rotate-password` so the credential version and audit event remain consistent.

Run `npm run test:integration` only with `AUTH_INTEGRATION_DATABASE_URL` pointing to a disposable PostgreSQL database. The authentication integration test applies committed migrations and creates temporary identity records. It must never target the personal or company production database.

For a checkout that contains legacy JSON data, use the one-time idempotent importers:

```powershell
npm run db:import-json
npm run db:import-json-research
```

Connection strings and contact-hash secrets belong in `.env.local` and must never be committed or printed. `.env.example` documents variable names only.

## Before adding a feature

A developer or coding agent should answer these questions before writing persistence code:

1. Is this campaign data, canonical prospect data, campaign-specific review state, evidence, provider provenance or personalisation data?
2. Which existing table owns it?
3. Does the change require a new version instead of editing approved data?
4. Which uniqueness, status or foreign-key invariant can PostgreSQL enforce?
5. Does the write require an audit event, an idempotency record or both in the same transaction?
6. Does the API expose a stable contract instead of returning database rows directly?

If the answer requires another database, ORM, queue or an automatic outreach path, stop and obtain an architecture or product decision first.
