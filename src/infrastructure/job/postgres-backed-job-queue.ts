import type { RedisClientType } from 'redis';

import type { JobQueue } from '@/application/job/ports';
import type { Job, JobSubmission } from '@/domain/job-contract/models';
import type { PostgresDb } from '@/infrastructure/postgres/client';

import {
  createPostgresJobLedger,
  type ClaimJobResult,
  type JobDispatchOutboxItem,
} from './postgres-job-ledger';
import {
  createRedisJobDispatcher,
  type DispatchSignal,
} from './redis-job-dispatcher';

type PostgresBackedJobQueueOptions = {
  maxAttempts?: number;
  leaseDurationMs?: number;
  outboxBatchSize?: number;
  consumerGroup?: string;
  consumerName?: string;
  visibilityTimeoutMs?: number;
};

const DEFAULT_OUTBOX_BATCH_SIZE = 25;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createPostgresBackedJobQueue(
  input: {
    redis: RedisClientType;
    db?: PostgresDb;
  },
  options: PostgresBackedJobQueueOptions = {},
): JobQueue {
  const ledger = createPostgresJobLedger(input.db, {
    maxAttempts: options.maxAttempts,
    leaseDurationMs: options.leaseDurationMs,
  });
  const dispatcher = createRedisJobDispatcher(input.redis, {
    consumerGroup: options.consumerGroup,
    consumerName: options.consumerName,
    visibilityTimeoutMs: options.visibilityTimeoutMs,
  });
  const activeSignals = new Map<string, DispatchSignal>();
  const outboxBatchSize =
    options.outboxBatchSize ?? DEFAULT_OUTBOX_BATCH_SIZE;

  async function publishOutboxItem(item: JobDispatchOutboxItem) {
    try {
      const streamEntryId = await dispatcher.publish(item.jobId);
      await ledger.markDispatchPublished({
        outboxId: item.id,
        jobId: item.jobId,
        redisStreamEntryId: streamEntryId,
      });
    } catch (error) {
      await ledger.markDispatchFailed({
        outboxId: item.id,
        jobId: item.jobId,
        error: errorMessage(error),
      });
    }
  }

  async function flushDispatchOutbox() {
    const pendingItems = await ledger.listPublishableOutbox(outboxBatchSize);

    for (const item of pendingItems) {
      await publishOutboxItem(item);
    }
  }

  async function acknowledgeSignal(jobId: string) {
    const signal = activeSignals.get(jobId);

    if (!signal) {
      return;
    }

    try {
      await dispatcher.acknowledge(signal);
      activeSignals.delete(jobId);
    } catch (error) {
      console.error('job.redis_ack_failed', {
        jobId,
        streamEntryId: signal.streamEntryId,
        errorMessage: errorMessage(error),
      });
    }
  }

  async function acknowledgeStaleSignal(signal: DispatchSignal) {
    try {
      await dispatcher.acknowledge(signal);
    } catch (error) {
      console.error('job.redis_stale_ack_failed', {
        jobId: signal.jobId,
        streamEntryId: signal.streamEntryId,
        errorMessage: errorMessage(error),
      });
    }
  }

  function jobFromClaimResult(result: ClaimJobResult): Job | null {
    return result.kind === 'claimed' ? result.job : null;
  }

  return {
    async submit(submission: JobSubmission): Promise<Job> {
      const job = await ledger.create(submission);
      await flushDispatchOutbox();
      return (await ledger.getById(job.id)) ?? job;
    },

    async consume(): Promise<Job | null> {
      await ledger.recoverExpiredLeases();
      await flushDispatchOutbox();

      const signal = await dispatcher.receive();

      if (!signal) {
        return null;
      }

      const claimResult = await ledger.claimJob({
        jobId: signal.jobId,
        workerId: dispatcher.consumerName,
        redisStreamEntryId: signal.streamEntryId,
      });

      if (claimResult.kind === 'claimed') {
        activeSignals.set(signal.jobId, signal);
        return jobFromClaimResult(claimResult);
      }

      if (
        claimResult.kind === 'not_found' ||
        claimResult.kind === 'terminal' ||
        claimResult.kind === 'dead_lettered'
      ) {
        await acknowledgeStaleSignal(signal);
      }

      return null;
    },

    async updateStatus(jobId, update): Promise<void> {
      if (update.status === 'completed') {
        await ledger.markCompleted({
          jobId,
          result: update.result ?? {},
          workerId: dispatcher.consumerName,
        });
        await acknowledgeSignal(jobId);
        return;
      }

      if (update.status === 'failed') {
        await ledger.markFailed({
          jobId,
          error: update.error ?? '任务执行失败。',
          workerId: dispatcher.consumerName,
        });
        await acknowledgeSignal(jobId);
        return;
      }

      throw new Error(
        `Postgres-backed job queue does not support direct status update: ${update.status}`,
      );
    },

    async getById(jobId): Promise<Job | null> {
      return await ledger.getById(jobId);
    },
  };
}
