import { sql } from 'drizzle-orm';
import { integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const graphSyncRuns = platformSchema.table('graph_sync_runs', {
  id: text('id').primaryKey(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  scopeType: text('scope_type').notNull(),
  scopeKey: text('scope_key').notNull(),
  triggerType: text('trigger_type').notNull(),
  triggeredBy: text('triggered_by').notNull(),
  cursorSnapshot: jsonb('cursor_snapshot')
    .notNull()
    .default(sql`'{}'::jsonb`),
  nodesWritten: integer('nodes_written').notNull().default(0),
  edgesWritten: integer('edges_written').notNull().default(0),
  errorSummary: text('error_summary'),
  errorDetail: jsonb('error_detail'),
  startedAt: timestamp('started_at', {
    withTimezone: true,
  }),
  finishedAt: timestamp('finished_at', {
    withTimezone: true,
  }),
  createdAt: timestamp('created_at', {
    withTimezone: true,
  }).notNull(),
  updatedAt: timestamp('updated_at', {
    withTimezone: true,
  }).notNull(),
});
