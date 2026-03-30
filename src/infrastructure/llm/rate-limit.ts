import type { RedisClientType } from 'redis';

import { redisKeys } from '@/infrastructure/redis/keys';

import { LlmRateLimitExceededError } from './errors';

type EnforceLlmRateLimitParams = {
  redis: RedisClientType;
  userId: string;
  organizationId: string;
  purpose: string;
  maxRequests: number;
  windowSeconds: number;
};

export async function enforceLlmRateLimit({
  redis,
  userId,
  organizationId,
  purpose,
  maxRequests,
  windowSeconds,
}: EnforceLlmRateLimitParams): Promise<void> {
  const rateLimitKey = redisKeys.rate(
    userId,
    `llm:${organizationId}:${purpose}`,
  );

  const requestCount = Number(
    await redis.eval(
      `
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return current
      `,
      {
        keys: [rateLimitKey],
        arguments: [String(windowSeconds)],
      },
    ),
  );

  if (requestCount > maxRequests) {
    throw new LlmRateLimitExceededError(
      `模型调用已达到限流上限（${maxRequests}/${windowSeconds}s）。`,
    );
  }
}
