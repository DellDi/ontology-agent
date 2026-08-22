import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const analysisExecutionEvents = platformSchema.table(
  'analysis_execution_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    executionId: text('execution_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    eventTimestamp: timestamp('event_timestamp', { withTimezone: true }).notNull(),
    status: text('status'),
    message: text('message'),
    renderBlocks: jsonb('render_blocks').notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    errorCode: text('error_code'),
    traceId: text('trace_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('analysis_execution_events_execution_sequence_uidx').on(
      table.executionId,
      table.sequence,
    ),
    index('analysis_execution_events_access_idx').on(
      table.sessionId,
      table.executionId,
      table.ownerUserId,
      table.sequence,
    ),
  ],
);
