import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const jobs = platformSchema.table(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    payload: jsonb('payload').notNull(),
    result: jsonb('result'),
    error: text('error'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    availableAt: timestamp('available_at', {
      withTimezone: true,
    }).notNull(),
    lockedBy: text('locked_by'),
    lockedUntil: timestamp('locked_until', {
      withTimezone: true,
    }),
    redisStreamEntryId: text('redis_stream_entry_id'),
    dispatchStatus: text('dispatch_status').notNull().default('pending'),
    ownerUserId: text('owner_user_id'),
    organizationId: text('organization_id'),
    sessionId: text('session_id'),
    originCorrelationId: text('origin_correlation_id'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    }).notNull(),
    startedAt: timestamp('started_at', {
      withTimezone: true,
    }),
    completedAt: timestamp('completed_at', {
      withTimezone: true,
    }),
    failedAt: timestamp('failed_at', {
      withTimezone: true,
    }),
  },
  (table) => [
    index('jobs_status_available_at_idx').on(table.status, table.availableAt),
    index('jobs_locked_until_idx').on(table.lockedUntil),
    index('jobs_owner_user_id_idx').on(table.ownerUserId),
    index('jobs_session_id_idx').on(table.sessionId),
    index('jobs_dispatch_status_idx').on(
      table.dispatchStatus,
      table.updatedAt,
    ),
    index('jobs_created_at_idx').on(table.createdAt),
  ],
);

export const jobEvents = platformSchema.table(
  'job_events',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    workerId: text('worker_id'),
    message: text('message'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index('job_events_job_id_created_at_idx').on(table.jobId, table.createdAt),
    index('job_events_event_type_created_at_idx').on(
      table.eventType,
      table.createdAt,
    ),
  ],
);

export const jobDispatchOutbox = platformSchema.table(
  'job_dispatch_outbox',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    redisStreamEntryId: text('redis_stream_entry_id'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    }).notNull(),
    publishedAt: timestamp('published_at', {
      withTimezone: true,
    }),
  },
  (table) => [
    index('job_dispatch_outbox_status_updated_at_idx').on(
      table.status,
      table.updatedAt,
    ),
    index('job_dispatch_outbox_job_id_idx').on(table.jobId),
  ],
);

export type DbJob = typeof jobs.$inferSelect;
export type DbJobDispatchOutbox = typeof jobDispatchOutbox.$inferSelect;
