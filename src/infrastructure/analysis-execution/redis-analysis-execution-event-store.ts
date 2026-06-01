import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';

import type { AnalysisExecutionEventStore } from '@/application/analysis-execution/stream-ports';
import {
  validateAnalysisExecutionStreamEvent,
  type AnalysisExecutionStreamEvent,
} from '@/domain/analysis-execution/stream-models';
import { redisKeys } from '@/infrastructure/redis/keys';

const MAX_EVENT_COUNT = 200;

/** Redis stream 键过期时间：72 小时，防止分析会话数据永久驻留造成内存泄漏。 */
export const STREAM_TTL_SECONDS = 72 * 60 * 60;

export function createRedisAnalysisExecutionEventStore(
  redis: RedisClientType,
): AnalysisExecutionEventStore {
  return {
    async append(input) {
      const streamKey = redisKeys.stream(input.sessionId);
      const sequence = await redis.incr(
        redisKeys.streamSequence(input.sessionId),
      );

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
        tool: input.tool,
        renderBlocks: input.renderBlocks,
        metadata: input.metadata,
      });

      await redis.rPush(streamKey, JSON.stringify(event));
      await redis.lTrim(streamKey, -MAX_EVENT_COUNT, -1);

      // 每次 append 刷新 stream 和 sequence key 的 TTL，防止内存泄漏
      await redis.expire(streamKey, STREAM_TTL_SECONDS);
      await redis.expire(
        redisKeys.streamSequence(input.sessionId),
        STREAM_TTL_SECONDS,
      );

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
