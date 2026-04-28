import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';

import { redisKeys } from '@/infrastructure/redis/keys';

export type DispatchSignal = {
  jobId: string;
  streamEntryId: string;
};

type RedisJobDispatcherOptions = {
  consumerGroup?: string;
  consumerName?: string;
  visibilityTimeoutMs?: number;
};

const DEFAULT_CONSUMER_GROUP = 'ontology-agent-workers';
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

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

function parseStreamMessage(raw: unknown): DispatchSignal | null {
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
      return jobId ? { jobId, streamEntryId } : null;
    }
  }

  return null;
}

function parseReadGroupResponse(raw: unknown): DispatchSignal | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const firstStream = raw[0];

  if (!Array.isArray(firstStream) || !Array.isArray(firstStream[1])) {
    return null;
  }

  return parseStreamMessage(firstStream[1][0]);
}

function parseAutoClaimResponse(raw: unknown): DispatchSignal | null {
  if (!Array.isArray(raw) || !Array.isArray(raw[1]) || raw[1].length === 0) {
    return null;
  }

  return parseStreamMessage(raw[1][0]);
}

export function createRedisJobDispatcher(
  redis: RedisClientType,
  options: RedisJobDispatcherOptions = {},
) {
  const queueKey = redisKeys.jobQueue();
  const consumerGroup = options.consumerGroup ?? DEFAULT_CONSUMER_GROUP;
  const consumerName =
    options.consumerName ??
    `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  const visibilityTimeoutMs =
    options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
  let groupReady = false;

  async function ensureReady() {
    if (groupReady) {
      return;
    }

    await ensureConsumerGroup(redis, queueKey, consumerGroup);
    groupReady = true;
  }

  return {
    consumerName,

    async publish(jobId: string): Promise<string> {
      const streamEntryId = await redis.xAdd(queueKey, '*', {
        jobId,
      });

      return streamEntryId;
    },

    async receive(): Promise<DispatchSignal | null> {
      await ensureReady();

      const reclaimed = parseAutoClaimResponse(
        await redis.sendCommand([
          'XAUTOCLAIM',
          queueKey,
          consumerGroup,
          consumerName,
          String(visibilityTimeoutMs),
          '0-0',
          'COUNT',
          '1',
        ]),
      );

      if (reclaimed) {
        return reclaimed;
      }

      return parseReadGroupResponse(
        await redis.sendCommand([
          'XREADGROUP',
          'GROUP',
          consumerGroup,
          consumerName,
          'COUNT',
          '1',
          'STREAMS',
          queueKey,
          '>',
        ]),
      );
    },

    async acknowledge(signal: DispatchSignal): Promise<void> {
      await ensureReady();
      await redis.sendCommand([
        'XACK',
        queueKey,
        consumerGroup,
        signal.streamEntryId,
      ]);
    },
  };
}
