import { sql } from 'drizzle-orm';
import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const analysisSessions = platformSchema.table(
  'analysis_sessions',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    organizationId: text('organization_id').notNull(),
    projectIds: text('project_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    areaIds: text('area_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    questionText: text('question_text').notNull(),
    savedContext: jsonb('saved_context').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index('analysis_sessions_owner_user_id_idx').on(table.ownerUserId),
    index('analysis_sessions_org_owner_idx').on(
      table.organizationId,
      table.ownerUserId,
    ),
    index('analysis_sessions_updated_at_idx').on(table.updatedAt),
  ],
);
