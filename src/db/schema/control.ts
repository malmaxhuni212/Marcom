import { sql } from 'drizzle-orm';
import {
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { campaigns } from './campaign';
import { workspaceMemberships, workspaces } from './identity';

type JsonObject = Record<string, unknown>;

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    actorKey: varchar('actor_key', { length: 200 }).notNull(),
    operation: varchar('operation', { length: 120 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<JsonObject>(),
    resourceType: varchar('resource_type', { length: 80 }),
    resourceId: uuid('resource_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idempotency_records_command_unique').on(
      table.workspaceId,
      table.actorKey,
      table.operation,
      table.idempotencyKey,
    ),
    index('idempotency_records_expires_idx').on(table.expiresAt),
    check(
      'idempotency_records_status_check',
      sql`${table.status} in ('processing', 'completed', 'failed')`,
    ),
    check(
      'idempotency_records_response_status_check',
      sql`${table.responseStatus} is null or ${table.responseStatus} between 100 and 599`,
    ),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    actorType: varchar('actor_type', { length: 24 }).notNull(),
    actorMembershipId: uuid('actor_membership_id'),
    actorServiceAccountId: uuid('actor_service_account_id'),
    action: varchar('action', { length: 160 }).notNull(),
    subjectType: varchar('subject_type', { length: 80 }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    reason: text('reason'),
    safeDiff: jsonb('safe_diff').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    requestId: uuid('request_id'),
    jobId: uuid('job_id'),
    ipHash: char('ip_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('audit_events_campaign_created_idx').on(table.campaignId, table.createdAt),
    index('audit_events_subject_created_idx').on(table.subjectType, table.subjectId, table.createdAt),
    index('audit_events_request_idx').on(table.requestId),
    index('audit_events_job_idx').on(table.jobId),
    foreignKey({
      name: 'audit_events_actor_membership_fk',
      columns: [table.workspaceId, table.actorMembershipId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.id],
    }).onDelete('restrict'),
    check('audit_events_actor_type_check', sql`${table.actorType} in ('membership', 'service', 'system')`),
    check(
      'audit_events_actor_reference_check',
      sql`(
        (${table.actorType} = 'membership' and ${table.actorMembershipId} is not null and ${table.actorServiceAccountId} is null)
        or (${table.actorType} = 'service' and ${table.actorMembershipId} is null and ${table.actorServiceAccountId} is not null)
        or (${table.actorType} = 'system' and ${table.actorMembershipId} is null and ${table.actorServiceAccountId} is null)
      )`,
    ),
  ],
);
