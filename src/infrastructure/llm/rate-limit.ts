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

  const multi = redis.multi();
  multi.incr(rateLimitKey);
  multi.expire(rateLimitKey, windowSeconds);

  const result = await multi.exec();
  const firstReply = Array.isArray(result) ? result[0] : null;
  const requestCount =
    typeof firstReply === 'number'
      ? firstReply
      : Array.isArray(firstReply) && typeof firstReply[1] === 'number'
        ? firstReply[1]
        : 0;

  if (requestCount > maxRequests) {
    throw new LlmRateLimitExceededError(
      `模型调用已达到限流上限（${maxRequests}/${windowSeconds}s）。`,
    );
  }
}
