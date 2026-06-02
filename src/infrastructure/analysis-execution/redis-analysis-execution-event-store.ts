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

/**
 * Lua 脚本：原子执行 RPUSH + LTRIM + EXPIRE(stream) + EXPIRE(sequence)。
 *
 * KEYS[1] = stream key，KEYS[2] = sequence key
 * ARGV[1] = event JSON，ARGV[2] = max count，ARGV[3] = TTL seconds
 *
 * 将写入与 TTL 刷新合并为单次原子操作，避免进程在 RPUSH 与 EXPIRE
 * 之间崩溃导致 key 丢失 TTL 或事件丢失。INCR 本身是原子的，保留在
 * Lua 外部以便在 JS 侧构建带有正确 sequence 的事件对象。
 */
const APPEND_SCRIPT = `
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], -tonumber(ARGV[2]), -1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
return 1
`;

export function createRedisAnalysisExecutionEventStore(
  redis: RedisClientType,
): AnalysisExecutionEventStore {
  return {
    async append(input) {
      const streamKey = redisKeys.stream(input.sessionId);
      const sequenceKey = redisKeys.streamSequence(input.sessionId);

      const sequence = await redis.incr(sequenceKey);

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

      await redis.eval(APPEND_SCRIPT, {
        keys: [streamKey, sequenceKey],
        arguments: [
          JSON.stringify(event),
          String(MAX_EVENT_COUNT),
          String(STREAM_TTL_SECONDS),
        ],
      });

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
