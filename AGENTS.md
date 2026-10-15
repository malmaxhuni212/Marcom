<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Database change rules

Before changing persistence code, read [`docs/database-schema.md`](docs/database-schema.md), the relevant files under `src/db/schema/`, and every existing migration under `drizzle/`.

- PostgreSQL is the application source of truth.
- Drizzle schema files define the intended physical schema.
- Committed SQL migrations define how deployed databases reach that schema.
- Never edit a migration that may already have been applied. Add a new migration instead.
- Never add a field only to TypeScript or JSON storage when it belongs in PostgreSQL.
- Keep personalisation JSON storage clearly separated until its own database migration is implemented.
- Run `npm run db:generate`, review the SQL, then run the database and application verification commands documented in the schema guide.
