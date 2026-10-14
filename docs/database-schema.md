# Database schema guide

This guide is the entry point for developers and coding agents working on MARCOM persistence. It covers backlog tasks DB-001, DB-002 and DB-003 at a practical level. The executable schema remains in code and migrations.

## Sources of truth

Use these sources in this order:

1. `src/db/schema/*.ts` defines the intended PostgreSQL tables, columns, foreign keys, checks and indexes.
2. `drizzle/*.sql` defines the reviewed migration path used by shared and local databases.
3. Repository and server-store code under `src/db/` and `src/marcom/memory/server-store.ts` defines how application workflows read and write the tables.
4. This document explains ownership, relationships and change rules that may not be obvious from individual files.

The live Netlify database contains applied runtime state. It is not a substitute for committed schema and migration files. A fresh database must be reproducible from this repository.

## Current persistence boundary

PostgreSQL is authoritative for:

- the local pilot workspace, user and membership;
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
| Identity | `workspaces`, `users`, `workspace_memberships` | Provides the loopback-only local pilot actor and workspace scope. It does not implement login. |
| Campaign | `campaigns`, `stored_files`, `campaign_briefs` | Stores the campaign record and versioned brief input. |
| Configuration | `campaign_config_versions`, `campaign_field_definitions`, `search_plan_versions`, `message_template_versions` | Stores editable and approved versions used by human gates and later processing. |
| Research queue | `jobs`, `job_items`, `research_runs` | Tracks bounded work, retries, progress and terminal status. |
| Prospect data | `prospects`, `prospect_identifiers`, `contact_points`, `campaign_prospects`, `duplicate_candidates` | Separates a canonical person or organisation from its campaign-specific review and engagement state. |
| Evidence and provenance | `research_results`, `evidence_items`, `provider_operations` | Preserves raw search results, evidence for facts, provider identity, usage and cost data. |
| Control | `idempotency_records`, `audit_events` | Prevents duplicate command effects and records material state changes. |

## Important relationships and invariants

- Every campaign belongs to one workspace.
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
7. Apply the migration with `npm run db:migrate`.
8. Verify connectivity and expected records with `npm run db:check`.
9. Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`.

Never edit an existing migration after it has been applied to a shared database. Create the next migration instead. The application must not mutate the schema automatically at startup.

## Setup and operational commands

```powershell
npm run db:migrate
npm run db:seed
npm run db:check
```

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
