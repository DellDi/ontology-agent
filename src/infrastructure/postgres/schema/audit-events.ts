import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const auditEvents = platformSchema.table(
  'audit_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    organizationId: text('organization_id').notNull(),
    sessionId: text('session_id'),
    eventType: text('event_type').notNull(),
    eventResult: text('event_result').notNull(),
    eventSource: text('event_source').notNull(),
    correlationId: text('correlation_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    retentionUntil: timestamp('retention_until', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index('audit_events_user_id_idx').on(table.userId),
    index('audit_events_session_id_idx').on(table.sessionId),
    index('audit_events_event_type_idx').on(table.eventType),
    index('audit_events_created_at_idx').on(table.createdAt),
    index('audit_events_retention_until_idx').on(table.retentionUntil),
    index('audit_events_correlation_id_idx').on(table.correlationId),
  ],
);
