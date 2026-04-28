import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';

import type { JobQueue } from '../../application/job/ports';
import type { Job, JobSubmission } from '../../domain/job-contract/models';
import { redisKeys } from '../redis/keys';

function jobStorageKey(jobId: string) {
  return redisKeys.worker(jobId, 'data');
}

function jobStreamEntryKey(jobId: string) {
  return redisKeys.worker(jobId, 'stream-entry');
}

function jobAttemptKey(jobId: string) {
  return redisKeys.worker(jobId, 'attempts');
}

type RedisJobQueueOptions = {
  consumerGroup?: string;
  consumerName?: string;
  visibilityTimeoutMs?: number;
  maxAttempts?: number;
};

const DEFAULT_CONSUMER_GROUP = 'ontology-agent-workers';
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const SUBMIT_JOB_SCRIPT = `
local stream_id = redis.call('XADD', KEYS[2], '*', 'jobId', ARGV[2])
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[3], stream_id)
redis.call('SET', KEYS[4], '0')
return stream_id
`;

async function ensureConsumerGroup(
  redis: RedisClientType,
  queueKey: string,
  consumerGroup: string,
) {
  try {
    await redis.sendCommand([
      'XGROUP',
      'CREATE',
      queueKey,
      consumerGroup,
      '0',
      'MKSTREAM',
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes('BUSYGROUP')) {
      throw error;
    }
  }
}

function parseStreamMessage(
  raw: unknown,
): { streamEntryId: string; jobId: string } | null {
  if (!Array.isArray(raw) || raw.length < 2) {
    return null;
  }

  const streamEntryId = String(raw[0] ?? '');
  const fields = raw[1];

  if (!streamEntryId || !Array.isArray(fields)) {
    return null;
  }

  for (let index = 0; index < fields.length; index += 2) {
    if (String(fields[index]) === 'jobId') {
      const jobId = String(fields[index + 1] ?? '');
      return jobId ? { streamEntryId, jobId } : null;
    }
  }

  return null;
}

function parseReadGroupResponse(
  raw: unknown,
): { streamEntryId: string; jobId: string } | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const firstStream = raw[0];

  if (!Array.isArray(firstStream) || !Array.isArray(firstStream[1])) {
    return null;
  }

  return parseStreamMessage(firstStream[1][0]);
}

function parseAutoClaimResponse(
  raw: unknown,
): { streamEntryId: string; jobId: string } | null {
  if (!Array.isArray(raw) || !Array.isArray(raw[1]) || raw[1].length === 0) {
    return null;
  }

  return parseStreamMessage(raw[1][0]);
}

async function readClaimedOrNewJobId(input: {
  redis: RedisClientType;
  queueKey: string;
  consumerGroup: string;
  consumerName: string;
  visibilityTimeoutMs: number;
}) {
  const reclaimed = parseAutoClaimResponse(
    await input.redis.sendCommand([
      'XAUTOCLAIM',
      input.queueKey,
      input.consumerGroup,
      input.consumerName,
      String(input.visibilityTimeoutMs),
      '0-0',
      'COUNT',
      '1',
    ]),
  );

  if (reclaimed) {
    return reclaimed;
  }

  return parseReadGroupResponse(
    await input.redis.sendCommand([
      'XREADGROUP',
      'GROUP',
      input.consumerGroup,
      input.consumerName,
      'COUNT',
      '1',
      'STREAMS',
      input.queueKey,
      '>',
    ]),
  );
}

async function acknowledgeJob(input: {
  redis: RedisClientType;
  queueKey: string;
  consumerGroup: string;
  jobId: string;
}) {
  const streamEntryId = await input.redis.get(jobStreamEntryKey(input.jobId));

  if (!streamEntryId) {
    return;
  }

  await input.redis.sendCommand([
    'XACK',
    input.queueKey,
    input.consumerGroup,
    streamEntryId,
  ]);
}

export function createRedisJobQueue(
  redis: RedisClientType,
  options: RedisJobQueueOptions = {},
): JobQueue {
  const queueKey = redisKeys.jobQueue();
  const deadLetterQueueKey = redisKeys.jobDeadLetterQueue();
  const consumerGroup = options.consumerGroup ?? DEFAULT_CONSUMER_GROUP;
  const consumerName =
    options.consumerName ??
    `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  const visibilityTimeoutMs =
    options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let groupReady = false;

  async function ensureReady() {
    if (groupReady) {
      return;
    }

    await ensureConsumerGroup(redis, queueKey, consumerGroup);
    groupReady = true;
  }

  return {
    async submit(submission: JobSubmission): Promise<Job> {
      const job: Job = {
        id: submission.id ?? randomUUID(),
        type: submission.type,
        status: 'pending',
        data: submission.data ?? {},
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await redis.eval(SUBMIT_JOB_SCRIPT, {
        keys: [
          jobStorageKey(job.id),
          queueKey,
          jobStreamEntryKey(job.id),
          jobAttemptKey(job.id),
        ],
        arguments: [JSON.stringify(job), job.id],
      });

      return job;
    },

    async consume(): Promise<Job | null> {
      await ensureReady();
      const streamMessage = await readClaimedOrNewJobId({
        redis,
        queueKey,
        consumerGroup,
        consumerName,
        visibilityTimeoutMs,
      });

      if (!streamMessage) {
        return null;
      }

      const { jobId, streamEntryId } = streamMessage;
      const raw = await redis.get(jobStorageKey(jobId));

      if (!raw) {
        await redis.sendCommand([
          'XACK',
          queueKey,
          consumerGroup,
          streamEntryId,
        ]);
        return null;
      }

      const attempts = await redis.incr(jobAttemptKey(jobId));
      const job: Job = JSON.parse(raw);

      if (attempts > maxAttempts) {
        job.status = 'failed';
        job.error = `任务超过最大重试次数 ${maxAttempts}，已进入 dead-letter queue。`;
        job.updatedAt = new Date().toISOString();
        await redis.set(jobStorageKey(job.id), JSON.stringify(job));
        await redis.xAdd(deadLetterQueueKey, '*', {
          jobId: job.id,
          streamEntryId,
          attempts: String(attempts),
        });
        await redis.sendCommand([
          'XACK',
          queueKey,
          consumerGroup,
          streamEntryId,
        ]);
        return null;
      }

      job.status = 'processing';
      job.updatedAt = new Date().toISOString();

      await redis.set(jobStorageKey(job.id), JSON.stringify(job));
      await redis.set(jobStreamEntryKey(job.id), streamEntryId);

      return job;
    },

    async updateStatus(jobId, update): Promise<void> {
      const raw = await redis.get(jobStorageKey(jobId));

      if (!raw) {
        return;
      }

      const job: Job = JSON.parse(raw);
      job.status = update.status;
      job.updatedAt = update.updatedAt;

      if (update.result !== undefined) {
        job.result = update.result;
      }

      if (update.error !== undefined) {
        job.error = update.error;
      }

      await redis.set(jobStorageKey(job.id), JSON.stringify(job));

      if (update.status === 'completed' || update.status === 'failed') {
        await ensureReady();
        await acknowledgeJob({
          redis,
          queueKey,
          consumerGroup,
          jobId,
        });
      }
    },

    async getById(jobId): Promise<Job | null> {
      const raw = await redis.get(jobStorageKey(jobId));

      if (!raw) {
        return null;
      }

      return JSON.parse(raw);
    },
  };
}
