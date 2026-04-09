import { sql } from 'drizzle-orm';
import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const analysisExecutionSnapshots = platformSchema.table(
  'analysis_execution_snapshots',
  {
    executionId: text('execution_id').primaryKey(),
    sessionId: text('session_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    followUpId: text('follow_up_id'),
    status: text('status').notNull(),
    planSnapshot: jsonb('plan_snapshot').notNull(),
    stepResults: jsonb('step_results')
      .notNull()
      .default(sql`'[]'::jsonb`),
    conclusionState: jsonb('conclusion_state')
      .notNull()
      .default(sql`'{}'::jsonb`),
    resultBlocks: jsonb('result_blocks')
      .notNull()
      .default(sql`'[]'::jsonb`),
    mobileProjection: jsonb('mobile_projection')
      .notNull()
      .default(sql`'{}'::jsonb`),
    failurePoint: jsonb('failure_point'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index('analysis_execution_snapshots_session_id_idx').on(table.sessionId),
    index('analysis_execution_snapshots_owner_updated_idx').on(
      table.ownerUserId,
      table.updatedAt,
    ),
    index('analysis_execution_snapshots_follow_up_id_idx').on(table.followUpId),
  ],
);
