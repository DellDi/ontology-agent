import { sql } from 'drizzle-orm';
import {
  index,
  pgSchema,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const platformSchema = pgSchema('platform');

export const authSessions = platformSchema.table(
  'auth_sessions',
  {
    sessionId: text('session_id').primaryKey(),
    userId: text('user_id').notNull(),
    displayName: text('display_name').notNull(),
    organizationId: text('organization_id').notNull(),
    projectIds: text('project_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    areaIds: text('area_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    roleCodes: text('role_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ],
);
