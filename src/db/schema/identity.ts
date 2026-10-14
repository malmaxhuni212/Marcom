import { sql } from 'drizzle-orm';
import {
  check,
  index,
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
    passwordHash: varchar('password_hash', { length: 255 }),
    status: varchar('status', { length: 24 }).notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_normalized_unique').on(table.emailNormalized),
    check('users_auth_method_check', sql`${table.authMethod} in ('local_actor', 'password', 'sso')`),
    check('users_status_check', sql`${table.status} in ('invited', 'active', 'disabled')`),
    check(
      'users_password_hash_check',
      sql`${table.authMethod} <> 'password' or ${table.passwordHash} is not null`,
    ),
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
    index('workspace_memberships_workspace_status_idx').on(table.workspaceId, table.status),
    check(
      'workspace_memberships_status_check',
      sql`${table.status} in ('active', 'suspended', 'removed')`,
    ),
  ],
);
