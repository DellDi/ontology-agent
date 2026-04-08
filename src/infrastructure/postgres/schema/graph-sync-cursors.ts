import { text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const graphSyncCursors = platformSchema.table('graph_sync_cursors', {
  sourceName: text('source_name').primaryKey(),
  cursorTime: timestamp('cursor_time', {
    withTimezone: true,
  }),
  cursorPk: text('cursor_pk'),
  lastRunId: text('last_run_id'),
  updatedAt: timestamp('updated_at', {
    withTimezone: true,
  }).notNull(),
});
