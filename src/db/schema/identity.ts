import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    defaultTimezone: varchar('default_timezone', { length: 64 })
      .notNull()
      .default('Europe/London'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspaces_slug_unique').on(table.slug),
    check('workspaces_status_check', sql`${table.status} in ('active', 'suspended', 'archived')`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    emailNormalized: varchar('email_normalized', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    authMethod: varchar('auth_method', { length: 24 }).notNull(),
    usernameNormalized: varchar('username_normalized', { length: 64 }),
    passwordHash: varchar('password_hash', { length: 255 }),
    credentialVersion: integer('credential_version').notNull().default(0),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    status: varchar('status', { length: 24 }).notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_normalized_unique').on(table.emailNormalized),
    uniqueIndex('users_username_normalized_unique')
      .on(table.usernameNormalized)
      .where(sql`${table.usernameNormalized} is not null`),
    check('users_auth_method_check', sql`${table.authMethod} in ('local_actor', 'password', 'sso')`),
    check('users_status_check', sql`${table.status} in ('invited', 'active', 'disabled')`),
    check(
      'users_password_hash_check',
      sql`${table.authMethod} <> 'password' or ${table.passwordHash} is not null`,
    ),
    check(
      'users_password_identity_check',
      sql`${table.authMethod} <> 'password' or (
        ${table.usernameNormalized} is not null
        and ${table.passwordHash} is not null
        and ${table.credentialVersion} >= 1
        and ${table.passwordChangedAt} is not null
      )`,
    ),
    check('users_credential_version_check', sql`${table.credentialVersion} >= 0`),
  ],
);

export const authLoginAttempts = pgTable(
  'auth_login_attempts',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    identifierHash: char('identifier_hash', { length: 64 }).notNull(),
    sourceHash: char('source_hash', { length: 64 }),
    succeeded: boolean('succeeded').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('auth_login_attempts_identifier_time_idx').on(
      table.workspaceId,
      table.identifierHash,
      table.attemptedAt,
    ),
    index('auth_login_attempts_cleanup_idx').on(table.attemptedAt),
  ],
);

export const workspaceMemberships = pgTable(
  'workspace_memberships',
  {
    id: uuid('id').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 24 }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'workspace_memberships_pkey', columns: [table.id] }),
    uniqueIndex('workspace_memberships_workspace_user_unique').on(table.workspaceId, table.userId),
    uniqueIndex('workspace_memberships_workspace_id_unique').on(table.workspaceId, table.id),
    uniqueIndex('workspace_memberships_workspace_user_id_unique').on(
      table.workspaceId,
      table.userId,
      table.id,
    ),
    index('workspace_memberships_workspace_status_idx').on(table.workspaceId, table.status),
    check(
      'workspace_memberships_status_check',
      sql`${table.status} in ('active', 'suspended', 'removed')`,
    ),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    csrfTokenHash: char('csrf_token_hash', { length: 64 }).notNull(),
    credentialVersion: integer('credential_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: varchar('revocation_reason', { length: 160 }),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_hash_unique').on(table.tokenHash),
    index('auth_sessions_user_active_idx')
      .on(table.workspaceId, table.userId, table.absoluteExpiresAt)
      .where(sql`${table.revokedAt} is null`),
    index('auth_sessions_expiry_cleanup_idx').on(table.absoluteExpiresAt, table.revokedAt),
    foreignKey({
      name: 'auth_sessions_membership_fk',
      columns: [table.workspaceId, table.userId, table.membershipId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
        workspaceMemberships.id,
      ],
    }).onDelete('cascade'),
    check('auth_sessions_credential_version_check', sql`${table.credentialVersion} >= 1`),
    check(
      'auth_sessions_expiry_order_check',
      sql`${table.idleExpiresAt} > ${table.createdAt}
        and ${table.absoluteExpiresAt} > ${table.createdAt}
        and ${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),
    check(
      'auth_sessions_revocation_check',
      sql`(
        ${table.revokedAt} is null and ${table.revocationReason} is null
      ) or (
        ${table.revokedAt} is not null and ${table.revocationReason} is not null
      )`,
    ),
  ],
);

export const guestUsageQuotas = pgTable(
  'guest_usage_quotas',
  {
    guestIdHash: char('guest_id_hash', { length: 64 }).primaryKey(),
    dayBucket: char('day_bucket', { length: 10 }).notNull(),
    monthBucket: char('month_bucket', { length: 7 }).notNull(),
    researchDayCount: integer('research_day_count').notNull().default(0),
    researchMonthCount: integer('research_month_count').notNull().default(0),
    personalizationDayCount: integer('personalization_day_count').notNull().default(0),
    personalizationMonthCount: integer('personalization_month_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('guest_usage_quotas_updated_at_idx').on(table.updatedAt),
    check(
      'guest_usage_quotas_counts_bounds_check',
      sql`${table.researchDayCount} >= 0
        and ${table.researchDayCount} <= 5
        and ${table.researchMonthCount} >= 0
        and ${table.researchMonthCount} <= 15
        and ${table.personalizationDayCount} >= 0
        and ${table.personalizationDayCount} <= 2
        and ${table.personalizationMonthCount} >= 0
        and ${table.personalizationMonthCount} <= 5`,
    ),
  ],
);
