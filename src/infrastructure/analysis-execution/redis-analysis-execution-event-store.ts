import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';

import type { AnalysisExecutionEventStore } from '@/application/analysis-execution/stream-ports';
import {
  validateAnalysisExecutionStreamEvent,
  type AnalysisExecutionStreamEvent,
} from '@/domain/analysis-execution/stream-models';
import { redisKeys } from '@/infrastructure/redis/keys';

const MAX_EVENT_COUNT = 200;

export function createRedisAnalysisExecutionEventStore(
  redis: RedisClientType,
): AnalysisExecutionEventStore {
  return {
    async append(input) {
      const streamKey = redisKeys.stream(input.sessionId);
      const sequence = (await redis.lLen(streamKey)) + 1;

      const event = validateAnalysisExecutionStreamEvent({
        id: randomUUID(),
        sessionId: input.sessionId,
        executionId: input.executionId,
        sequence,
        kind: input.kind,
        timestamp: new Date().toISOString(),
        status: input.status,
        message: input.message,
        step: input.step,
        stage: input.stage,
        renderBlocks: input.renderBlocks,
        metadata: input.metadata,
      });

      await redis.rPush(streamKey, JSON.stringify(event));
      await redis.lTrim(streamKey, -MAX_EVENT_COUNT, -1);

      return event;
    },

    async listBySession(sessionId) {
      const rawEvents = await redis.lRange(redisKeys.stream(sessionId), 0, -1);

      return rawEvents
        .map((rawEvent) =>
          validateAnalysisExecutionStreamEvent(
            JSON.parse(rawEvent),
          ) as AnalysisExecutionStreamEvent,
        )
        .sort((left, right) => left.sequence - right.sequence);
    },
  };
}
