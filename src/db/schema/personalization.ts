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
import { campaignProspects } from './research';

type JsonObject = Record<string, unknown>;

export const personalizationSettings = pgTable(
  'personalization_settings',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id').notNull(),
    settings: jsonb('settings').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    rowVersion: integer('row_version').notNull().default(1),
    updatedByMembershipId: uuid('updated_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('personalization_settings_campaign_unique').on(table.campaignId),
    foreignKey({
      name: 'personalization_settings_campaign_fk',
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'personalization_settings_updater_fk',
      columns: [table.workspaceId, table.updatedByMembershipId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.id],
    }).onDelete('restrict'),
    check('personalization_settings_row_version_check', sql`${table.rowVersion} > 0`),
  ],
);

export const messageDrafts = pgTable(
  'message_drafts',
  {
    id: uuid('id').primaryKey(),
    campaignProspectId: uuid('campaign_prospect_id')
      .notNull()
      .references(() => campaignProspects.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    channel: varchar('channel', { length: 24 }).notNull(),
    subject: text('subject'),
    content: text('content').notNull(),
    alternativeOpening: text('alternative_opening'),
    copyPayload: jsonb('copy_payload').$type<JsonObject>().notNull(),
    status: varchar('status', { length: 24 }).notNull().default('draft'),
    parentDraftId: uuid('parent_draft_id'),
    generationOperationId: uuid('generation_operation_id'),
    warnings: jsonb('warnings').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    contentHash: char('content_hash', { length: 64 }).notNull(),
    createdByMembershipId: uuid('created_by_membership_id').references(
      () => workspaceMemberships.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('message_drafts_prospect_channel_version_unique').on(
      table.campaignProspectId,
      table.channel,
      table.version,
    ),
    index('message_drafts_prospect_status_created_idx').on(
      table.campaignProspectId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: 'message_drafts_parent_fk',
      columns: [table.parentDraftId],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    check('message_drafts_version_check', sql`${table.version} > 0`),
    check(
      'message_drafts_channel_check',
      sql`${table.channel} in ('email', 'linkedin', 'multi_channel')`,
    ),
    check(
      'message_drafts_status_check',
      sql`${table.status} in ('draft', 'in_review', 'approved', 'rejected', 'superseded')`,
    ),
  ],
);

export const personalizationProfiles = pgTable(
  'personalization_profiles',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id').notNull(),
    campaignProspectId: uuid('campaign_prospect_id').notNull(),
    recordId: varchar('record_id', { length: 255 }).notNull(),
    currentMessageDraftId: uuid('current_message_draft_id'),
    status: varchar('status', { length: 32 }).notNull(),
    personalizationAngle: text('personalization_angle'),
    recipientIncentive: text('recipient_incentive'),
    recommendedChannel: varchar('recommended_channel', { length: 32 }),
    confidence: varchar('confidence', { length: 16 }),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('personalization_profiles_campaign_record_unique').on(
      table.campaignId,
      table.recordId,
    ),
    uniqueIndex('personalization_profiles_campaign_prospect_unique').on(table.campaignProspectId),
    index('personalization_profiles_campaign_status_updated_idx').on(
      table.campaignId,
      table.status,
      table.updatedAt,
    ),
    foreignKey({
      name: 'personalization_profiles_campaign_fk',
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'personalization_profiles_campaign_prospect_fk',
      columns: [table.workspaceId, table.campaignProspectId],
      foreignColumns: [campaignProspects.workspaceId, campaignProspects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'personalization_profiles_current_draft_fk',
      columns: [table.currentMessageDraftId],
      foreignColumns: [messageDrafts.id],
    }).onDelete('restrict'),
    check(
      'personalization_profiles_status_check',
      sql`${table.status} in ('draft', 'approved', 'rejected', 'needs_more_research', 'failed')`,
    ),
    check(
      'personalization_profiles_confidence_check',
      sql`${table.confidence} is null or ${table.confidence} in ('high', 'medium', 'low')`,
    ),
  ],
);
