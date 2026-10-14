import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
import { workspaceMemberships, workspaces } from './identity';

type JsonObject = Record<string, unknown>;

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    ownerMembershipId: uuid('owner_membership_id'),
    title: varchar('title', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    activeConfigVersionId: uuid('active_config_version_id'),
    rowVersion: integer('row_version').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campaigns_workspace_slug_unique').on(table.workspaceId, table.slug),
    uniqueIndex('campaigns_workspace_id_unique').on(table.workspaceId, table.id),
    index('campaigns_workspace_status_updated_idx').on(table.workspaceId, table.status, table.updatedAt),
    foreignKey({
      name: 'campaigns_owner_membership_fk',
      columns: [table.workspaceId, table.ownerMembershipId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.id],
    }).onDelete('restrict'),
    check('campaigns_row_version_check', sql`${table.rowVersion} > 0`),
    check(
      'campaigns_status_check',
      sql`${table.status} in ('draft', 'configuration_review', 'ready', 'researching', 'active', 'paused', 'completed', 'archived')`,
    ),
  ],
);

export const storedFiles = pgTable(
  'stored_files',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id'),
    storageKey: text('storage_key').notNull(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    declaredMimeType: varchar('declared_mime_type', { length: 120 }),
    detectedMimeType: varchar('detected_mime_type', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    createdByMembershipId: uuid('created_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('stored_files_storage_key_unique').on(table.storageKey),
    index('stored_files_workspace_sha256_idx').on(table.workspaceId, table.sha256),
    foreignKey({
      name: 'stored_files_campaign_fk',
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stored_files_creator_membership_fk',
      columns: [table.workspaceId, table.createdByMembershipId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.id],
    }).onDelete('restrict'),
    check('stored_files_size_check', sql`${table.sizeBytes} > 0`),
    check(
      'stored_files_status_check',
      sql`${table.status} in ('stored', 'extracting', 'ready', 'rejected', 'failed', 'deleted')`,
    ),
  ],
);

export const campaignBriefs = pgTable(
  'campaign_briefs',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    inputMethod: varchar('input_method', { length: 16 }).notNull(),
    storedFileId: uuid('stored_file_id').references(() => storedFiles.id, { onDelete: 'restrict' }),
    sourceText: text('source_text').notNull(),
    contentHash: char('content_hash', { length: 64 }).notNull(),
    parserName: varchar('parser_name', { length: 80 }),
    parserVersion: varchar('parser_version', { length: 40 }),
    createdByMembershipId: uuid('created_by_membership_id').references(
      () => workspaceMemberships.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campaign_briefs_campaign_version_unique').on(table.campaignId, table.version),
    uniqueIndex('campaign_briefs_campaign_id_unique').on(table.campaignId, table.id),
    index('campaign_briefs_campaign_created_idx').on(table.campaignId, table.createdAt),
    check('campaign_briefs_version_check', sql`${table.version} > 0`),
    check('campaign_briefs_input_method_check', sql`${table.inputMethod} in ('form', 'paste', 'upload')`),
    check(
      'campaign_briefs_upload_file_check',
      sql`${table.inputMethod} <> 'upload' or ${table.storedFileId} is not null`,
    ),
  ],
);

export const campaignConfigVersions = pgTable(
  'campaign_config_versions',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    briefId: uuid('brief_id'),
    version: integer('version').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('draft'),
    objective: text('objective').notNull(),
    primaryCta: text('primary_cta').notNull(),
    successEvent: jsonb('success_event').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    targetCriteria: jsonb('target_criteria').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    exclusions: jsonb('exclusions').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    sourcePreferences: jsonb('source_preferences').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    approvedFacts: jsonb('approved_facts').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    messagingGuidance: jsonb('messaging_guidance').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    followupPolicy: jsonb('followup_policy').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    schemaVersion: integer('schema_version').notNull().default(1),
    rowVersion: integer('row_version').notNull().default(1),
    proposalOperationId: uuid('proposal_operation_id'),
    createdByMembershipId: uuid('created_by_membership_id').references(
      () => workspaceMemberships.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campaign_config_versions_campaign_version_unique').on(table.campaignId, table.version),
    uniqueIndex('campaign_config_versions_campaign_id_unique').on(table.campaignId, table.id),
    index('campaign_config_versions_campaign_status_version_idx').on(
      table.campaignId,
      table.status,
      table.version,
    ),
    foreignKey({
      name: 'campaign_config_versions_brief_fk',
      columns: [table.campaignId, table.briefId],
      foreignColumns: [campaignBriefs.campaignId, campaignBriefs.id],
    }).onDelete('restrict'),
    check('campaign_config_versions_version_check', sql`${table.version} > 0`),
    check('campaign_config_versions_schema_version_check', sql`${table.schemaVersion} > 0`),
    check('campaign_config_versions_row_version_check', sql`${table.rowVersion} > 0`),
    check(
      'campaign_config_versions_status_check',
      sql`${table.status} in ('draft', 'in_review', 'approved', 'superseded', 'rejected')`,
    ),
  ],
);

export const campaignFieldDefinitions = pgTable(
  'campaign_field_definitions',
  {
    id: uuid('id').primaryKey(),
    configVersionId: uuid('config_version_id')
      .notNull()
      .references(() => campaignConfigVersions.id, { onDelete: 'restrict' }),
    fieldKey: varchar('field_key', { length: 80 }).notNull(),
    label: varchar('label', { length: 160 }).notNull(),
    fieldType: varchar('field_type', { length: 24 }).notNull(),
    required: boolean('required').notNull().default(false),
    filterable: boolean('filterable').notNull().default(true),
    sensitivity: varchar('sensitivity', { length: 16 }).notNull().default('normal'),
    options: jsonb('options').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campaign_field_definitions_config_key_unique').on(table.configVersionId, table.fieldKey),
    index('campaign_field_definitions_config_sort_idx').on(table.configVersionId, table.sortOrder),
    check('campaign_field_definitions_key_check', sql`${table.fieldKey} ~ '^[a-z][a-z0-9_]{0,79}$'`),
    check(
      'campaign_field_definitions_type_check',
      sql`${table.fieldType} in ('text', 'long_text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'url', 'email', 'single_select', 'multi_select')`,
    ),
    check(
      'campaign_field_definitions_sensitivity_check',
      sql`${table.sensitivity} in ('normal', 'personal', 'restricted')`,
    ),
    check('campaign_field_definitions_sort_order_check', sql`${table.sortOrder} >= 0`),
  ],
);

export const searchPlanVersions = pgTable(
  'search_plan_versions',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    configVersionId: uuid('config_version_id').notNull(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('draft'),
    batchSize: integer('batch_size').notNull(),
    enrichmentDepth: varchar('enrichment_depth', { length: 16 }).notNull(),
    queryFamilies: jsonb('query_families').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    limitations: jsonb('limitations').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    schemaVersion: integer('schema_version').notNull().default(1),
    rowVersion: integer('row_version').notNull().default(1),
    createdByMembershipId: uuid('created_by_membership_id').references(
      () => workspaceMemberships.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('search_plan_versions_campaign_version_unique').on(table.campaignId, table.version),
    uniqueIndex('search_plan_versions_campaign_id_unique').on(table.campaignId, table.id),
    index('search_plan_versions_campaign_status_version_idx').on(table.campaignId, table.status, table.version),
    foreignKey({
      name: 'search_plan_versions_config_fk',
      columns: [table.campaignId, table.configVersionId],
      foreignColumns: [campaignConfigVersions.campaignId, campaignConfigVersions.id],
    }).onDelete('restrict'),
    check('search_plan_versions_batch_size_check', sql`${table.batchSize} between 1 and 50`),
    check('search_plan_versions_schema_version_check', sql`${table.schemaVersion} > 0`),
    check('search_plan_versions_row_version_check', sql`${table.rowVersion} > 0`),
    check(
      'search_plan_versions_status_check',
      sql`${table.status} in ('draft', 'in_review', 'approved', 'superseded', 'rejected')`,
    ),
    check(
      'search_plan_versions_enrichment_depth_check',
      sql`${table.enrichmentDepth} in ('basic', 'detailed')`,
    ),
  ],
);

export const messageTemplateVersions = pgTable(
  'message_template_versions',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    configVersionId: uuid('config_version_id').notNull(),
    version: integer('version').notNull(),
    templateKey: varchar('template_key', { length: 80 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    channel: varchar('channel', { length: 24 }).notNull(),
    subjectTemplate: text('subject_template'),
    bodyTemplate: text('body_template').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('draft'),
    createdByMembershipId: uuid('created_by_membership_id').references(
      () => workspaceMemberships.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('message_template_versions_campaign_template_version_unique').on(
      table.campaignId,
      table.templateKey,
      table.version,
    ),
    uniqueIndex('message_template_versions_campaign_id_unique').on(table.campaignId, table.id),
    index('message_template_versions_campaign_status_idx').on(table.campaignId, table.status),
    foreignKey({
      name: 'message_template_versions_config_fk',
      columns: [table.campaignId, table.configVersionId],
      foreignColumns: [campaignConfigVersions.campaignId, campaignConfigVersions.id],
    }).onDelete('restrict'),
    check('message_template_versions_version_check', sql`${table.version} > 0`),
    check(
      'message_template_versions_channel_check',
      sql`${table.channel} in ('email', 'sms', 'linkedin', 'x', 'facebook', 'instagram', 'other')`,
    ),
    check(
      'message_template_versions_status_check',
      sql`${table.status} in ('draft', 'approved', 'superseded', 'rejected')`,
    ),
  ],
);
