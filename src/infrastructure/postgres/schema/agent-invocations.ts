import { sql } from 'drizzle-orm';
import { index, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const agentInvocations = platformSchema.table(
  'agent_invocations',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    executionId: text('execution_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    agentName: text('agent_name').notNull(),
    toolName: text('tool_name').notNull(),
    kind: text('kind').notNull(),
    parentInvocationId: text('parent_invocation_id'),
    input: jsonb('input').notNull().default(sql`'{}'::jsonb`),
    output: jsonb('output'),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    traceId: text('trace_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('agent_invocations_execution_kind_tool_idx').on(
      table.executionId,
      table.kind,
      table.toolName,
    ),
    index('agent_invocations_trace_idx').on(table.traceId),
    index('agent_invocations_parent_idx').on(table.parentInvocationId),
    uniqueIndex('agent_invocations_agent_run_uidx')
      .on(table.executionId)
      .where(sql`kind = 'agent-run'`),
  ],
);
