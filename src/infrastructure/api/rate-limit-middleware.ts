import type { RedisClientType } from 'redis';

export type RateLimitConfig = {
  maxRequests: number;
  windowSeconds: number;
  keyPrefix: string;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; limit: number };

/**
 * 基于 Redis 的固定窗口限流检查。
 *
 * 使用 INCR + EXPIRE 实现：每次请求递增计数，首次请求时设置窗口过期时间。
 * 超过 maxRequests 后拒绝并返回剩余等待秒数。
 */
export async function checkRateLimit(
  redis: RedisClientType,
  config: RateLimitConfig,
  identifier: string,
): Promise<RateLimitResult> {
  const key = `${config.keyPrefix}:${identifier}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, config.windowSeconds);
  }

  if (count > config.maxRequests) {
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfterSeconds: ttl > 0 ? ttl : config.windowSeconds,
      limit: config.maxRequests,
    };
  }

  return { allowed: true };
}

/** 执行分析端点限流：60 秒内最多 5 次 */
export const EXECUTION_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowSeconds: 60,
  keyPrefix: 'rl:analysis:execute',
};

/** 追问端点限流：60 秒内最多 10 次 */
export const FOLLOW_UP_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 60,
  keyPrefix: 'rl:analysis:follow-up',
};
