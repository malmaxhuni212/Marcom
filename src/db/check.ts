import { sql } from 'drizzle-orm';
import { closeDatabasePool, getDatabase } from './client';
import { loadDatabaseEnvironment } from './load-environment';

loadDatabaseEnvironment();

async function main(): Promise<void> {
  const database = getDatabase();
  const result = await database.execute(sql<{
    database_name: string;
    workspace_count: number;
    user_count: number;
    membership_count: number;
    campaigns_table: string | null;
    audit_events_table: string | null;
    idempotency_records_table: string | null;
    prospects_table: string | null;
    research_runs_table: string | null;
    evidence_items_table: string | null;
  }>`
    select
      current_database() as database_name,
      (select count(*)::integer from workspaces where id = '10000000-0000-4000-8000-000000000001') as workspace_count,
      (select count(*)::integer from users where id = '10000000-0000-4000-8000-000000000002') as user_count,
      (select count(*)::integer from workspace_memberships where id = '10000000-0000-4000-8000-000000000003') as membership_count,
      to_regclass('public.campaigns')::text as campaigns_table,
      to_regclass('public.audit_events')::text as audit_events_table,
      to_regclass('public.idempotency_records')::text as idempotency_records_table,
      to_regclass('public.prospects')::text as prospects_table,
      to_regclass('public.research_runs')::text as research_runs_table,
      to_regclass('public.evidence_items')::text as evidence_items_table
  `);

  const state = result.rows[0];
  if (
    !state ||
    state.workspace_count !== 1 ||
    state.user_count !== 1 ||
    state.membership_count !== 1 ||
    state.campaigns_table !== 'campaigns' ||
    state.audit_events_table !== 'audit_events' ||
    state.idempotency_records_table !== 'idempotency_records' ||
    state.prospects_table !== 'prospects' ||
    state.research_runs_table !== 'research_runs' ||
    state.evidence_items_table !== 'evidence_items'
  ) {
    throw new Error('The database schema or local actor seed is incomplete.');
  }

  console.log(
    JSON.stringify({
      event: 'database_connection_ok',
      database: state.database_name,
      localActorSeeded: true,
      campaignSchemaReady: true,
      auditAndIdempotencyReady: true,
      researchSchemaReady: true,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'database_connection_failed',
        message: error instanceof Error ? error.message : 'Unknown database connection failure',
      }),
    );
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);
