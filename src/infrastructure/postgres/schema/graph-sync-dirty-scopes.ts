import { integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const graphSyncDirtyScopes = platformSchema.table(
  'graph_sync_dirty_scopes',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type').notNull(),
    scopeKey: text('scope_key').notNull(),
    reason: text('reason').notNull(),
    sourceName: text('source_name').notNull(),
    sourcePk: text('source_pk'),
    sourceProgress: jsonb('source_progress').notNull(),
    firstDetectedAt: timestamp('first_detected_at', {
      withTimezone: true,
    }).notNull(),
    lastDetectedAt: timestamp('last_detected_at', {
      withTimezone: true,
    }).notNull(),
    status: text('status').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastRunId: text('last_run_id'),
    errorSummary: text('error_summary'),
  },
);
