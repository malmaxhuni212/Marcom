import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { campaignConfigVersions, campaigns, searchPlanVersions } from './campaign';
import { workspaceMemberships, workspaces } from './identity';

type JsonObject = Record<string, unknown>;

export const prospects = pgTable(
  'prospects',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    entityType: varchar('entity_type', { length: 24 }).notNull(),
    canonicalName: varchar('canonical_name', { length: 240 }).notNull(),
    canonicalDomain: varchar('canonical_domain', { length: 255 }),
    primaryUrl: text('primary_url'),
    locationText: varchar('location_text', { length: 240 }),
    status: varchar('status', { length: 24 }).notNull().default('active'),
    mergedIntoProspectId: uuid('merged_into_prospect_id'),
    normalizationVersion: integer('normalization_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('prospects_workspace_id_unique').on(table.workspaceId, table.id),
    index('prospects_workspace_name_idx').on(table.workspaceId, table.canonicalName),
    index('prospects_workspace_domain_idx').on(table.workspaceId, table.canonicalDomain),
    index('prospects_workspace_status_idx').on(table.workspaceId, table.status),
    foreignKey({
      name: 'prospects_merged_into_fk',
      columns: [table.workspaceId, table.mergedIntoProspectId],
      foreignColumns: [table.workspaceId, table.id],
    }).onDelete('restrict'),
    check('prospects_entity_type_check', sql`${table.entityType} in ('person', 'organisation')`),
    check('prospects_status_check', sql`${table.status} in ('active', 'merged', 'deleted')`),
    check('prospects_normalization_version_check', sql`${table.normalizationVersion} > 0`),
    check('prospects_not_self_merged_check', sql`${table.mergedIntoProspectId} is null or ${table.mergedIntoProspectId} <> ${table.id}`),
    check(
      'prospects_merge_state_check',
      sql`(${table.status} = 'merged' and ${table.mergedIntoProspectId} is not null) or (${table.status} <> 'merged' and ${table.mergedIntoProspectId} is null)`,
    ),
  ],
);

export const prospectIdentifiers = pgTable(
  'prospect_identifiers',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    prospectId: uuid('prospect_id').notNull(),
    identifierType: varchar('identifier_type', { length: 32 }).notNull(),
    providerName: varchar('provider_name', { length: 80 }),
    displayValue: text('display_value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('prospect_identifiers_comparison_unique').on(
      table.workspaceId,
      table.identifierType,
      sql`coalesce(${table.providerName}, '')`,
      table.normalizedValue,
    ),
    index('prospect_identifiers_prospect_type_idx').on(table.prospectId, table.identifierType),
    foreignKey({
      name: 'prospect_identifiers_prospect_fk',
      columns: [table.workspaceId, table.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete('cascade'),
    check(
      'prospect_identifiers_type_check',
      sql`${table.identifierType} in ('profile_url', 'website_domain', 'provider_entity')`,
    ),
    check(
      'prospect_identifiers_provider_check',
      sql`${table.identifierType} <> 'provider_entity' or ${table.providerName} is not null`,
    ),
  ],
);

export const contactPoints = pgTable(
  'contact_points',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    prospectId: uuid('prospect_id').notNull(),
    channel: varchar('channel', { length: 32 }).notNull(),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    valueHash: char('value_hash', { length: 64 }).notNull(),
    isPublic: boolean('is_public').notNull().default(true),
    sourceUrl: text('source_url'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }),
    verificationStatus: varchar('verification_status', { length: 32 }).notNull().default('unverified'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('contact_points_prospect_value_unique').on(
      table.workspaceId,
      table.channel,
      table.valueHash,
      table.prospectId,
    ),
    index('contact_points_workspace_channel_hash_idx').on(table.workspaceId, table.channel, table.valueHash),
    foreignKey({
      name: 'contact_points_prospect_fk',
      columns: [table.workspaceId, table.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete('cascade'),
    check(
      'contact_points_channel_check',
      sql`${table.channel} in ('email', 'phone', 'contact_form', 'linkedin', 'x', 'facebook', 'instagram', 'other')`,
    ),
    check(
      'contact_points_verification_check',
      sql`${table.verificationStatus} in ('unverified', 'source_verified', 'invalid', 'suppressed')`,
    ),
  ],
);

export const campaignProspects = pgTable(
  'campaign_prospects',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    prospectId: uuid('prospect_id').notNull(),
    configVersionId: uuid('config_version_id').notNull(),
    ownerMembershipId: uuid('owner_membership_id'),
    sourceMethod: varchar('source_method', { length: 24 }).notNull(),
    researchStatus: varchar('research_status', { length: 32 }).notNull(),
    engagementStatus: varchar('engagement_status', { length: 32 }).notNull().default('not_started'),
    fitSummary: text('fit_summary'),
    customFields: jsonb('custom_fields').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    reviewNotes: text('review_notes'),
    rejectionReason: text('rejection_reason'),
    shortlistedAt: timestamp('shortlisted_at', { withTimezone: true }),
    reviewedByMembershipId: uuid('reviewed_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campaign_prospects_campaign_prospect_unique').on(table.campaignId, table.prospectId),
    uniqueIndex('campaign_prospects_workspace_id_unique').on(table.workspaceId, table.id),
    index('campaign_prospects_campaign_research_updated_idx').on(table.campaignId, table.researchStatus, table.updatedAt),
    index('campaign_prospects_campaign_engagement_updated_idx').on(table.campaignId, table.engagementStatus, table.updatedAt),
    index('campaign_prospects_owner_research_idx').on(table.ownerMembershipId, table.researchStatus),
    foreignKey({
      name: 'campaign_prospects_campaign_fk',
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'campaign_prospects_prospect_fk',
      columns: [table.workspaceId, table.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'campaign_prospects_config_fk',
      columns: [table.campaignId, table.configVersionId],
      foreignColumns: [campaignConfigVersions.campaignId, campaignConfigVersions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'campaign_prospects_owner_fk',
      columns: [table.workspaceId, table.ownerMembershipId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'campaign_prospects_reviewer_fk',
      columns: [table.workspaceId, table.reviewedByMembershipId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.id],
    }).onDelete('restrict'),
    check('campaign_prospects_source_check', sql`${table.sourceMethod} in ('manual', 'csv', 'provider')`),
    check(
      'campaign_prospects_research_status_check',
      sql`${table.researchStatus} in ('discovered', 'extracting', 'review_required', 'enrichment_requested', 'enrichment_failed', 'duplicate_review', 'shortlisted', 'rejected')`,
    ),
    check(
      'campaign_prospects_engagement_status_check',
      sql`${table.engagementStatus} in ('not_started', 'drafting', 'draft_ready', 'approved', 'sent', 'followup_due', 'responded', 'closed', 'suppressed')`,
    ),
    check(
      'campaign_prospects_rejection_reason_check',
      sql`${table.researchStatus} <> 'rejected' or nullif(trim(${table.rejectionReason}), '') is not null`,
    ),
  ],
);

export const duplicateCandidates = pgTable(
  'duplicate_candidates',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    prospectAId: uuid('prospect_a_id').notNull(),
    prospectBId: uuid('prospect_b_id').notNull(),
    score: numeric('score', { precision: 5, scale: 4 }).notNull(),
    basis: jsonb('basis').$type<JsonObject>().notNull(),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    resolvedByMembershipId: uuid('resolved_by_membership_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('duplicate_candidates_pair_unique').on(
      table.workspaceId,
      sql`least(${table.prospectAId}, ${table.prospectBId})`,
      sql`greatest(${table.prospectAId}, ${table.prospectBId})`,
    ),
    index('duplicate_candidates_workspace_status_score_idx').on(table.workspaceId, table.status, table.score),
    foreignKey({
      name: 'duplicate_candidates_prospect_a_fk',
      columns: [table.workspaceId, table.prospectAId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'duplicate_candidates_prospect_b_fk',
      columns: [table.workspaceId, table.prospectBId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'duplicate_candidates_resolver_fk',
      columns: [table.workspaceId, table.resolvedByMembershipId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.id],
    }).onDelete('restrict'),
    check('duplicate_candidates_distinct_check', sql`${table.prospectAId} <> ${table.prospectBId}`),
    check('duplicate_candidates_score_check', sql`${table.score} between 0 and 1`),
    check('duplicate_candidates_status_check', sql`${table.status} in ('pending', 'same', 'different', 'ignored')`),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    campaignId: uuid('campaign_id'),
    jobType: varchar('job_type', { length: 80 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    priority: smallint('priority').notNull().default(100),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    payloadSchemaVersion: integer('payload_schema_version').notNull().default(1),
    progress: jsonb('progress').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    idempotencyKey: varchar('idempotency_key', { length: 200 }),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: varchar('lease_owner', { length: 120 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    errorCategory: text('error_category'),
    errorDetail: text('error_detail'),
    createdByMembershipId: uuid('created_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('jobs_workspace_id_unique').on(table.workspaceId, table.id),
    uniqueIndex('jobs_idempotency_unique').on(table.workspaceId, table.jobType, table.idempotencyKey),
    index('jobs_campaign_created_idx').on(table.campaignId, table.createdAt),
    index('jobs_claim_idx').on(table.priority, table.runAfter, table.createdAt),
    index('jobs_lease_recovery_idx').on(table.leaseExpiresAt),
    foreignKey({
      name: 'jobs_campaign_fk',
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'jobs_creator_fk',
      columns: [table.workspaceId, table.createdByMembershipId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.id],
    }).onDelete('restrict'),
    check(
      'jobs_status_check',
      sql`${table.status} in ('queued', 'running', 'waiting_rate_limit', 'retry_scheduled', 'completed', 'completed_with_errors', 'failed', 'cancelled')`,
    ),
    check('jobs_priority_check', sql`${table.priority} >= 0`),
    check('jobs_attempt_check', sql`${table.attemptCount} >= 0 and ${table.maxAttempts} > 0`),
    check('jobs_payload_version_check', sql`${table.payloadSchemaVersion} > 0`),
    check(
      'jobs_terminal_time_check',
      sql`${table.status} not in ('completed', 'completed_with_errors', 'failed', 'cancelled') or ${table.completedAt} is not null`,
    ),
  ],
);

export const jobItems = pgTable(
  'job_items',
  {
    id: uuid('id').primaryKey(),
    jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    itemKey: varchar('item_key', { length: 240 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    input: jsonb('input').$type<JsonObject>().notNull(),
    result: jsonb('result').$type<JsonObject>(),
    attemptCount: integer('attempt_count').notNull().default(0),
    errorCategory: text('error_category'),
    errorDetail: text('error_detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('job_items_job_key_unique').on(table.jobId, table.itemKey),
    index('job_items_job_status_idx').on(table.jobId, table.status),
    check('job_items_status_check', sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'skipped')`),
    check('job_items_attempt_check', sql`${table.attemptCount} >= 0`),
  ],
);

export const researchRuns = pgTable(
  'research_runs',
  {
    id: uuid('id').primaryKey(),
    jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'restrict' }),
    searchPlanVersionId: uuid('search_plan_version_id').notNull(),
    requestedCount: integer('requested_count').notNull(),
    foundCount: integer('found_count').notNull().default(0),
    uniqueCount: integer('unique_count').notNull().default(0),
    enrichedCount: integer('enriched_count').notNull().default(0),
    reviewRequiredCount: integer('review_required_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('research_runs_job_unique').on(table.jobId),
    index('research_runs_campaign_created_idx').on(table.campaignId, table.createdAt),
    foreignKey({
      name: 'research_runs_search_plan_fk',
      columns: [table.campaignId, table.searchPlanVersionId],
      foreignColumns: [searchPlanVersions.campaignId, searchPlanVersions.id],
    }).onDelete('restrict'),
    check('research_runs_requested_count_check', sql`${table.requestedCount} between 1 and 50`),
    check(
      'research_runs_counts_check',
      sql`${table.foundCount} >= 0 and ${table.uniqueCount} >= 0 and ${table.enrichedCount} >= 0 and ${table.reviewRequiredCount} >= 0 and ${table.failedCount} >= 0`,
    ),
  ],
);

export const researchResults = pgTable(
  'research_results',
  {
    id: uuid('id').primaryKey(),
    researchRunId: uuid('research_run_id').notNull().references(() => researchRuns.id, { onDelete: 'cascade' }),
    jobItemId: uuid('job_item_id').unique().references(() => jobItems.id, { onDelete: 'set null' }),
    queryKey: varchar('query_key', { length: 120 }).notNull(),
    providerName: varchar('provider_name', { length: 80 }).notNull(),
    providerResultId: varchar('provider_result_id', { length: 255 }),
    rank: integer('rank'),
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    title: text('title'),
    snippet: text('snippet'),
    metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    status: varchar('status', { length: 24 }).notNull(),
    prospectId: uuid('prospect_id').references(() => prospects.id, { onDelete: 'restrict' }),
    campaignProspectId: uuid('campaign_prospect_id').references(() => campaignProspects.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('research_results_provider_result_unique').on(table.researchRunId, table.providerName, table.providerResultId),
    uniqueIndex('research_results_canonical_url_unique').on(table.researchRunId, table.canonicalUrl),
    index('research_results_run_status_rank_idx').on(table.researchRunId, table.status, table.rank),
    index('research_results_campaign_prospect_idx').on(table.campaignProspectId),
    check(
      'research_results_status_check',
      sql`${table.status} in ('received', 'duplicate', 'processing', 'accepted', 'rejected', 'failed')`,
    ),
    check('research_results_rank_check', sql`${table.rank} is null or ${table.rank} > 0`),
  ],
);

export const providerOperations = pgTable(
  'provider_operations',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    campaignId: uuid('campaign_id'),
    jobId: uuid('job_id'),
    jobItemId: uuid('job_item_id').references(() => jobItems.id, { onDelete: 'set null' }),
    campaignProspectId: uuid('campaign_prospect_id'),
    providerKind: varchar('provider_kind', { length: 24 }).notNull(),
    providerName: varchar('provider_name', { length: 80 }).notNull(),
    modelName: varchar('model_name', { length: 160 }),
    operation: varchar('operation', { length: 120 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    externalRequestId: varchar('external_request_id', { length: 255 }),
    promptVersion: varchar('prompt_version', { length: 80 }),
    schemaVersion: integer('schema_version').notNull().default(1),
    inputHash: char('input_hash', { length: 64 }).notNull(),
    outputHash: char('output_hash', { length: 64 }),
    usage: jsonb('usage').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    estimatedCost: numeric('estimated_cost', { precision: 14, scale: 6 }),
    currency: char('currency', { length: 3 }),
    latencyMs: integer('latency_ms'),
    errorCategory: text('error_category'),
    errorDetail: text('error_detail'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('provider_operations_campaign_created_idx').on(table.campaignId, table.createdAt),
    index('provider_operations_provider_operation_created_idx').on(table.providerName, table.operation, table.createdAt),
    index('provider_operations_job_item_idx').on(table.jobId, table.jobItemId),
    foreignKey({
      name: 'provider_operations_campaign_fk',
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'provider_operations_job_fk',
      columns: [table.workspaceId, table.jobId],
      foreignColumns: [jobs.workspaceId, jobs.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'provider_operations_campaign_prospect_fk',
      columns: [table.workspaceId, table.campaignProspectId],
      foreignColumns: [campaignProspects.workspaceId, campaignProspects.id],
    }).onDelete('restrict'),
    check('provider_operations_kind_check', sql`${table.providerKind} in ('search', 'ai')`),
    check('provider_operations_status_check', sql`${table.status} in ('started', 'succeeded', 'failed', 'rejected')`),
    check('provider_operations_schema_version_check', sql`${table.schemaVersion} > 0`),
    check('provider_operations_cost_check', sql`${table.estimatedCost} is null or ${table.estimatedCost} >= 0`),
    check('provider_operations_latency_check', sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`),
    check(
      'provider_operations_currency_check',
      sql`(${table.estimatedCost} is null and ${table.currency} is null) or (${table.estimatedCost} is not null and ${table.currency} is not null)`,
    ),
  ],
);

export const evidenceItems = pgTable(
  'evidence_items',
  {
    id: uuid('id').primaryKey(),
    campaignProspectId: uuid('campaign_prospect_id')
      .notNull()
      .references(() => campaignProspects.id, { onDelete: 'cascade' }),
    fieldKey: varchar('field_key', { length: 80 }).notNull(),
    valueJson: jsonb('value_json').$type<unknown>().notNull(),
    sourceUrl: text('source_url').notNull(),
    canonicalSourceUrl: text('canonical_source_url').notNull(),
    sourceTitle: text('source_title'),
    snippet: text('snippet'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
    confidence: varchar('confidence', { length: 16 }).notNull(),
    verificationStatus: varchar('verification_status', { length: 24 }).notNull(),
    researchResultId: uuid('research_result_id').references(() => researchResults.id, { onDelete: 'cascade' }),
    providerOperationId: uuid('provider_operation_id').references(() => providerOperations.id, { onDelete: 'set null' }),
    evidenceHash: char('evidence_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('evidence_items_hash_unique').on(table.campaignProspectId, table.evidenceHash),
    index('evidence_items_prospect_field_idx').on(table.campaignProspectId, table.fieldKey),
    index('evidence_items_canonical_url_idx').on(table.canonicalSourceUrl),
    check('evidence_items_field_key_check', sql`${table.fieldKey} ~ '^[a-z][a-z0-9_]{0,79}$'`),
    check('evidence_items_confidence_check', sql`${table.confidence} in ('high', 'medium', 'low')`),
    check(
      'evidence_items_verification_check',
      sql`${table.verificationStatus} in ('single_source', 'corroborated', 'contradicted', 'unknown')`,
    ),
  ],
);
