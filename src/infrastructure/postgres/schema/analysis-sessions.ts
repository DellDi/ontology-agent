import { index, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const analysisSessions = platformSchema.table(
  'analysis_sessions',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    questionText: text('question_text').notNull(),
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
    index('analysis_sessions_updated_at_idx').on(table.updatedAt),
  ],
);
