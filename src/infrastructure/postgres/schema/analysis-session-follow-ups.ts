import { bigint, index, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const analysisSessionFollowUps = platformSchema.table(
  'analysis_session_follow_ups',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    questionText: text('question_text').notNull(),
    parentFollowUpId: text('parent_follow_up_id'),
    referencedExecutionId: text('referenced_execution_id').notNull(),
    referencedConclusionTitle: text('referenced_conclusion_title'),
    referencedConclusionSummary: text('referenced_conclusion_summary'),
    resultExecutionId: text('result_execution_id'),
    inheritedContext: jsonb('inherited_context').notNull(),
    mergedContext: jsonb('merged_context').notNull(),
    createdOrder: bigint('created_order', { mode: 'number' })
      .generatedByDefaultAsIdentity()
      .notNull(),
    planVersion: integer('plan_version'),
    currentPlanSnapshot: jsonb('current_plan_snapshot'),
    previousPlanSnapshot: jsonb('previous_plan_snapshot'),
    currentPlanDiff: jsonb('current_plan_diff'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index('analysis_session_follow_ups_session_idx').on(table.sessionId),
    index('analysis_session_follow_ups_owner_session_idx').on(
      table.ownerUserId,
      table.sessionId,
    ),
    index('analysis_session_follow_ups_session_created_order_idx').on(
      table.sessionId,
      table.createdOrder,
    ),
    index('analysis_session_follow_ups_execution_idx').on(
      table.referencedExecutionId,
    ),
    index('analysis_session_follow_ups_result_execution_idx').on(
      table.resultExecutionId,
    ),
    index('analysis_session_follow_ups_created_at_idx').on(table.createdAt),
  ],
);
