import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const analysisUiMessageProjections = platformSchema.table(
  'analysis_ui_message_projections',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    executionId: text('execution_id').notNull(),
    followUpId: text('follow_up_id'),
    historyRoundId: text('history_round_id'),
    projectionVersion: integer('projection_version').notNull(),
    partSchemaVersion: integer('part_schema_version').notNull(),
    contractVersion: integer('contract_version').notNull(),
    status: text('status').notNull(),
    isTerminal: boolean('is_terminal').notNull(),
    streamCursor: jsonb('stream_cursor')
      .notNull()
      .default(sql`'{"lastSequence":0,"lastEventId":null}'::jsonb`),
    messages: jsonb('messages')
      .notNull()
      .default(sql`'[]'::jsonb`),
    recoveryMetadata: jsonb('recovery_metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index('analysis_ui_message_projection_owner_session_idx').on(
      table.ownerUserId,
      table.sessionId,
    ),
    index('analysis_ui_message_projection_owner_execution_idx').on(
      table.ownerUserId,
      table.executionId,
    ),
    index('analysis_ui_message_projection_session_round_idx').on(
      table.sessionId,
      table.historyRoundId,
    ),
    index('analysis_ui_message_projection_follow_up_idx').on(table.followUpId),
    index('analysis_ui_message_projection_updated_idx').on(table.updatedAt),
  ],
);
