# MARCOM automation prototype

This Next.js prototype analyses campaign briefs, stores structured campaign data, discovers prospects, and builds evidence-backed research records for human review.

The brief analyser remains separate from prospect search:

1. Groq analyses the uploaded campaign brief.
2. The selected search provider finds public web results.
3. Groq extracts candidate identities and research facts only from those supplied results.
4. Deterministic validation checks sources, evidence, duplicates, and unknown values before a record is saved.

## Local setup

Install dependencies:

```powershell
npm install
```

Copy the environment template:

```powershell
Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
```

Add the existing Groq key, an Exa key, and the read-write Netlify Database connection string to `.env.local`:

```text
GROQ_API_KEY=your_groq_key
SEARCH_PROVIDER=exa
EXA_API_KEY=your_exa_key
SEARCH_MAX_RESULTS=25
SEARCH_TIMEOUT_MS=15000
NETLIFY_DB_URL=your_netlify_postgres_connection_string
CONTACT_HASH_PEPPER=generate_a_long_random_local_secret
```

Do not commit `.env.local`.

Prepare the database on first setup and whenever new migrations are pulled:

```powershell
npm run db:migrate
npm run db:seed
npm run db:check
```

The seed is idempotent. Running it again does not create another local workspace or actor. Normal application startup only requires `npm run dev` after the database has been prepared.

For an existing checkout that still has campaigns in `memory/projects.json`, run this once after migration and seeding:

```powershell
npm run db:import-json
npm run db:import-json-research
```

The first importer creates PostgreSQL campaign records and copies matching runtime files to the new campaign IDs. The second importer moves research runs, prospects, evidence, review state and provider provenance into PostgreSQL. Neither importer deletes the original JSON files. Re-running either unchanged import is safe.

`CONTACT_HASH_PEPPER` protects deterministic contact-point lookup hashes. Use the same secret for every instance connected to the same database, keep it out of Git, and change it only through a planned data migration.

The database structure and change rules are documented in [`docs/database-schema.md`](docs/database-schema.md). Coding agents and developers should read that guide, the Drizzle schema files, and the existing SQL migrations before changing persistence code.

Run a small Exa search before starting the interface:

```powershell
npm run search:smoke
```

The command prints the provider, request ID, cost reported by the provider, and up to three normalized results. It does not print credentials.

Start the application:

```powershell
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Switching search providers

Set `SEARCH_PROVIDER` in `.env.local`, then restart the development server.

| Value | Purpose |
| --- | --- |
| `exa` | Live Exa web search. Requires `EXA_API_KEY`. |
| `fake` | Deterministic local results for UI and integration development. Uses no network or credits. |
| `groq-browser` | Compatibility adapter for the previous Groq browser-search implementation. |

The application routes and research agent depend on the shared `SearchProvider` contract. Vendor response types remain inside their adapters, so adding another provider does not require changes to campaign or research code.

## Verification

```powershell
npm test
npm run typecheck
npm run build
```

`npm test` runs the provider contract tests without calling a live provider.
