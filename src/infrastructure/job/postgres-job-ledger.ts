import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';

import type { Job, JobSubmission } from '@/domain/job-contract/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import {
  jobDispatchOutbox,
  jobEvents,
  jobs,
  type DbJob,
  type DbJobDispatchOutbox,
} from '@/infrastructure/postgres/schema/job-ledger';

const DEFAULT_MAX_ATTEMPTS = 3;
const TERMINAL_STATUSES = ['completed', 'failed', 'dead_letter'] as const;
const TS_OWNED_JOB = sql`coalesce(${jobs.payload} ->> 'executionContract', '') not in ('java-initial-v1', 'java-follow-up-v1')`;
const isJavaOwnedJob = (payload: Record<string, unknown>) =>
  payload.executionContract === 'java-initial-v1' ||
  payload.executionContract === 'java-follow-up-v1';
const TS_OWNED_OUTBOX = sql`exists (
  select 1 from ${jobs}
  where ${jobs.id} = ${jobDispatchOutbox.jobId}
    and ${TS_OWNED_JOB}
)`;

type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export type ClaimJobResult =
  | { kind: 'claimed'; job: Job }
  | { kind: 'not_found' }
  | { kind: 'terminal'; job: Job }
  | { kind: 'locked'; job: Job }
  | { kind: 'dead_lettered'; job: Job };

export type JobDispatchOutboxItem = {
  id: string;
  jobId: string;
  status: string;
  attemptCount: number;
};

type PostgresJobLedgerOptions = {
  maxAttempts?: number;
  leaseDurationMs?: number;
};

const DEFAULT_LEASE_DURATION_MS = 30_000;

function nowDate() {
  return new Date();
}

function toIso(date: Date | null) {
  return date ? date.toISOString() : null;
}

function isTerminalStatus(status: string): status is TerminalStatus {
  return TERMINAL_STATUSES.includes(status as TerminalStatus);
}

function readStringField(
  data: Record<string, unknown>,
  field: string,
): string | null {
  const value = data[field];

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function rowToJob(row: DbJob): Job {
  return {
    id: row.id,
    type: row.type as Job['type'],
    status: row.status as Job['status'],
    data: row.payload as Record<string, unknown>,
    result: (row.result as Record<string, unknown> | null) ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToOutboxItem(row: DbJobDispatchOutbox): JobDispatchOutboxItem {
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    attemptCount: row.attemptCount,
  };
}

export function createPostgresJobLedger(
  db?: PostgresDb,
  options: PostgresJobLedgerOptions = {},
) {
  const resolvedDb = db ?? createPostgresDb().db;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;

  return {
    async create(submission: JobSubmission): Promise<Job> {
      const createdAt = nowDate();
      const jobId = submission.id ?? randomUUID();
      const payload = submission.data ?? {};
      const job: Job = {
        id: jobId,
        type: submission.type,
        status: 'pending',
        data: payload,
        result: null,
        error: null,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      };

      await resolvedDb.transaction(async (tx) => {
        await tx.insert(jobs).values({
          id: job.id,
          type: job.type,
          status: job.status,
          payload,
          result: null,
          error: null,
          attemptCount: 0,
          maxAttempts,
          availableAt: createdAt,
          dispatchStatus: 'pending',
          ownerUserId: readStringField(payload, 'ownerUserId'),
          organizationId: readStringField(payload, 'organizationId'),
          sessionId: readStringField(payload, 'sessionId'),
          originCorrelationId: readStringField(payload, 'originCorrelationId'),
          createdAt,
          updatedAt: createdAt,
        });
        await tx.insert(jobEvents).values({
          id: randomUUID(),
          jobId: job.id,
          eventType: 'created',
          fromStatus: null,
          toStatus: 'pending',
          workerId: null,
          message: 'Job created in Postgres ledger.',
          metadata: {},
          createdAt,
        });
        if (!isJavaOwnedJob(payload)) {
          await tx.insert(jobDispatchOutbox).values({
            id: randomUUID(),
            jobId: job.id,
            status: 'pending',
            attemptCount: 0,
            lastError: null,
            redisStreamEntryId: null,
            createdAt,
            updatedAt: createdAt,
            publishedAt: null,
          });
        }
      });

      return job;
    },

    async getById(jobId: string): Promise<Job | null> {
      const rows = await resolvedDb
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      return rows[0] ? rowToJob(rows[0]) : null;
    },

    async listPublishableOutbox(limit: number): Promise<JobDispatchOutboxItem[]> {
      const rows = await resolvedDb
        .select()
        .from(jobDispatchOutbox)
        .where(and(
          inArray(jobDispatchOutbox.status, ['pending', 'failed']),
          TS_OWNED_OUTBOX,
        ))
        .orderBy(asc(jobDispatchOutbox.updatedAt))
        .limit(limit);

      return rows.map(rowToOutboxItem);
    },

    async markDispatchPublished(input: {
      outboxId: string;
      jobId: string;
      redisStreamEntryId: string;
    }): Promise<void> {
      const updatedAt = nowDate();

      await resolvedDb.transaction(async (tx) => {
        const outboxRows = await tx
          .update(jobDispatchOutbox)
          .set({
            status: 'published',
            attemptCount: sql`${jobDispatchOutbox.attemptCount} + 1`,
            lastError: null,
            redisStreamEntryId: input.redisStreamEntryId,
            updatedAt,
            publishedAt: updatedAt,
          })
          .where(and(eq(jobDispatchOutbox.id, input.outboxId),
            eq(jobDispatchOutbox.jobId, input.jobId), TS_OWNED_OUTBOX))
          .returning({ id: jobDispatchOutbox.id });
        if (outboxRows.length === 0) return;
        await tx
          .update(jobs)
          .set({
            status: 'queued',
            dispatchStatus: 'dispatched',
            redisStreamEntryId: input.redisStreamEntryId,
            error: null,
            updatedAt,
          })
          .where(
            and(
              eq(jobs.id, input.jobId),
              inArray(jobs.status, ['pending', 'queued']),
              TS_OWNED_JOB,
            ),
          );
        await tx.insert(jobEvents).values({
          id: randomUUID(),
          jobId: input.jobId,
          eventType: 'dispatched',
          fromStatus: 'pending',
          toStatus: 'queued',
          workerId: null,
          message: 'Redis dispatch signal published.',
          metadata: {
            redisStreamEntryId: input.redisStreamEntryId,
          },
          createdAt: updatedAt,
        });
      });
    },

    async markDispatchFailed(input: {
      outboxId: string;
      jobId: string;
      error: string;
    }): Promise<void> {
      const updatedAt = nowDate();

      await resolvedDb.transaction(async (tx) => {
        const outboxRows = await tx
          .update(jobDispatchOutbox)
          .set({
            status: 'failed',
            attemptCount: sql`${jobDispatchOutbox.attemptCount} + 1`,
            lastError: input.error,
            updatedAt,
          })
          .where(and(eq(jobDispatchOutbox.id, input.outboxId),
            eq(jobDispatchOutbox.jobId, input.jobId), TS_OWNED_OUTBOX))
          .returning({ id: jobDispatchOutbox.id });
        if (outboxRows.length === 0) return;
        await tx
          .update(jobs)
          .set({
            dispatchStatus: 'dispatch_failed',
            error: input.error,
            updatedAt,
          })
          .where(and(eq(jobs.id, input.jobId), TS_OWNED_JOB));
        await tx.insert(jobEvents).values({
          id: randomUUID(),
          jobId: input.jobId,
          eventType: 'dispatch_failed',
          fromStatus: null,
          toStatus: null,
          workerId: null,
          message: input.error,
          metadata: {},
          createdAt: updatedAt,
        });
      });
    },

    async claimJob(input: {
      jobId: string;
      workerId: string;
      redisStreamEntryId?: string | null;
    }): Promise<ClaimJobResult> {
      const claimedAt = nowDate();
      const lockedUntil = new Date(claimedAt.getTime() + leaseDurationMs);

      const claimedRows = await resolvedDb
        .update(jobs)
        .set({
          status: 'processing',
          attemptCount: sql`${jobs.attemptCount} + 1`,
          lockedBy: input.workerId,
          lockedUntil,
          redisStreamEntryId: input.redisStreamEntryId ?? null,
          startedAt: sql`coalesce(${jobs.startedAt}, ${claimedAt})`,
          updatedAt: claimedAt,
        })
        .where(
          sql`${jobs.id} = ${input.jobId}
            and ${jobs.status} in ('pending', 'queued', 'processing')
            and ${jobs.availableAt} <= ${claimedAt}
            and (${jobs.lockedUntil} is null or ${jobs.lockedUntil} < ${claimedAt})
            and ${jobs.attemptCount} < ${jobs.maxAttempts}
            and ${TS_OWNED_JOB}`,
        )
        .returning();

      const claimedRow = claimedRows[0];

      if (claimedRow) {
        await resolvedDb.insert(jobEvents).values({
          id: randomUUID(),
          jobId: input.jobId,
          eventType: 'claimed',
          fromStatus: null,
          toStatus: 'processing',
          workerId: input.workerId,
          message: 'Worker claimed job from Postgres ledger.',
          metadata: {
            attemptCount: claimedRow.attemptCount,
            lockedUntil: toIso(claimedRow.lockedUntil),
            redisStreamEntryId: input.redisStreamEntryId ?? null,
          },
          createdAt: claimedAt,
        });

        return {
          kind: 'claimed',
          job: rowToJob(claimedRow),
        };
      }

      const rows = await resolvedDb
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, input.jobId), TS_OWNED_JOB))
        .limit(1);
      const row = rows[0];

      if (!row) {
        return { kind: 'not_found' };
      }

      if (isTerminalStatus(row.status)) {
        return {
          kind: 'terminal',
          job: rowToJob(row),
        };
      }

      if (row.attemptCount >= row.maxAttempts) {
        const deadLettered = await this.markDeadLetter({
          jobId: input.jobId,
          workerId: input.workerId,
          error: `任务超过最大重试次数 ${row.maxAttempts}，已进入 dead-letter queue。`,
          metadata: {
            attemptCount: row.attemptCount,
            maxAttempts: row.maxAttempts,
            redisStreamEntryId: input.redisStreamEntryId ?? null,
          },
        });

        return {
          kind: 'dead_lettered',
          job: deadLettered,
        };
      }

      return {
        kind: 'locked',
        job: rowToJob(row),
      };
    },

    async markCompleted(input: {
      jobId: string;
      result: Record<string, unknown>;
      workerId: string;
    }): Promise<void> {
      const completedAt = nowDate();

      await resolvedDb.transaction(async (tx) => {
        const updatedRows = await tx
          .update(jobs)
          .set({
            status: 'completed',
            result: input.result,
            error: null,
            lockedBy: null,
            lockedUntil: null,
            dispatchStatus: 'acknowledged',
            completedAt,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(jobs.id, input.jobId),
              TS_OWNED_JOB,
              eq(jobs.status, 'processing'),
              eq(jobs.lockedBy, input.workerId),
              sql`${jobs.lockedUntil} >= ${completedAt}`,
            ),
          )
          .returning({ id: jobs.id });
        if (updatedRows.length !== 1) {
          throw new Error(`Job ${input.jobId} is not owned by this TypeScript worker lease.`);
        }
        await tx.insert(jobEvents).values({
          id: randomUUID(),
          jobId: input.jobId,
          eventType: 'completed',
          fromStatus: 'processing',
          toStatus: 'completed',
          workerId: input.workerId,
          message: 'Job completed.',
          metadata: {},
          createdAt: completedAt,
        });
      });
    },

    async markFailed(input: {
      jobId: string;
      error: string;
      workerId: string;
    }): Promise<void> {
      const failedAt = nowDate();

      await resolvedDb.transaction(async (tx) => {
        const updatedRows = await tx
          .update(jobs)
          .set({
            status: 'failed',
            error: input.error,
            lockedBy: null,
            lockedUntil: null,
            dispatchStatus: 'acknowledged',
            failedAt,
            updatedAt: failedAt,
          })
          .where(
            and(
              eq(jobs.id, input.jobId),
              TS_OWNED_JOB,
              eq(jobs.status, 'processing'),
              eq(jobs.lockedBy, input.workerId),
              sql`${jobs.lockedUntil} >= ${failedAt}`,
            ),
          )
          .returning({ id: jobs.id });
        if (updatedRows.length !== 1) {
          throw new Error(`Job ${input.jobId} is not owned by this TypeScript worker lease.`);
        }
        await tx.insert(jobEvents).values({
          id: randomUUID(),
          jobId: input.jobId,
          eventType: 'failed',
          fromStatus: 'processing',
          toStatus: 'failed',
          workerId: input.workerId,
          message: input.error,
          metadata: {},
          createdAt: failedAt,
        });
      });
    },

    async markDeadLetter(input: {
      jobId: string;
      error: string;
      workerId?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<Job> {
      const failedAt = nowDate();
      const rows = await resolvedDb.transaction(async (tx) => {
        const updatedRows = await tx
          .update(jobs)
          .set({
            status: 'dead_letter',
            error: input.error,
            lockedBy: null,
            lockedUntil: null,
            dispatchStatus: 'acknowledged',
            failedAt,
            updatedAt: failedAt,
          })
          .where(
            and(
              eq(jobs.id, input.jobId),
              TS_OWNED_JOB,
              sql`(
                (${jobs.status} in ('pending', 'queued') and ${jobs.attemptCount} >= ${jobs.maxAttempts})
                or (${jobs.status} = 'processing' and ${jobs.attemptCount} >= ${jobs.maxAttempts}
                    and ${jobs.lockedUntil} < ${failedAt})
                or (${jobs.status} = 'processing' and ${jobs.lockedBy} = ${input.workerId ?? null}
                    and ${jobs.lockedUntil} >= ${failedAt})
              )`,
            ),
          )
          .returning();
        if (updatedRows.length !== 1) {
          throw new Error(`Job ${input.jobId} is not owned by this TypeScript worker lease.`);
        }
        await tx.insert(jobEvents).values({
          id: randomUUID(),
          jobId: input.jobId,
          eventType: 'dead_lettered',
          fromStatus: null,
          toStatus: 'dead_letter',
          workerId: input.workerId ?? null,
          message: input.error,
          metadata: input.metadata ?? {},
          createdAt: failedAt,
        });

        return updatedRows;
      });

      return rowToJob(rows[0]);
    },

    async recoverExpiredLeases(limit = 25): Promise<Job[]> {
      const recoveredAt = nowDate();
      const expiredRows = await resolvedDb
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.status, 'processing'),
            lt(jobs.lockedUntil, recoveredAt),
            sql`${jobs.attemptCount} < ${jobs.maxAttempts}`,
            TS_OWNED_JOB,
          ),
        )
        .orderBy(asc(jobs.lockedUntil))
        .limit(limit);

      if (expiredRows.length === 0) {
        return [];
      }

      const expiredJobIds = expiredRows.map((row) => row.id);
      const rows = await resolvedDb
        .update(jobs)
        .set({
          status: 'queued',
          lockedBy: null,
          lockedUntil: null,
          dispatchStatus: 'pending',
          updatedAt: recoveredAt,
        })
        .where(inArray(jobs.id, expiredJobIds))
        .returning();

      for (const row of expiredRows) {
        await resolvedDb.insert(jobDispatchOutbox).values({
          id: randomUUID(),
          jobId: row.id,
          status: 'pending',
          attemptCount: 0,
          lastError: null,
          redisStreamEntryId: null,
          createdAt: recoveredAt,
          updatedAt: recoveredAt,
          publishedAt: null,
        });
        await resolvedDb.insert(jobEvents).values({
          id: randomUUID(),
          jobId: row.id,
          eventType: 'lease_expired',
          fromStatus: 'processing',
          toStatus: 'queued',
          workerId: row.lockedBy,
          message: 'Job lease expired and was returned to queue.',
          metadata: {
            attemptCount: row.attemptCount,
            lockedUntil: toIso(row.lockedUntil),
          },
          createdAt: recoveredAt,
        });
      }

      return rows.map(rowToJob);
    },
  };
}
