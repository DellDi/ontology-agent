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
 * 使用 Lua 脚本原子化 INCR + 条件 EXPIRE，避免进程崩溃导致 key 永久存在、
 * 用户被永久限流的问题。超过 maxRequests 后拒绝并返回剩余等待秒数。
 */
export async function checkRateLimit(
  redis: RedisClientType,
  config: RateLimitConfig,
  identifier: string,
): Promise<RateLimitResult> {
  const key = `${config.keyPrefix}:${identifier}`;

  const luaScript = `
    local current = redis.call('INCR', KEYS[1])
    if current == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return current
  `;

  const count = (await redis.eval(luaScript, {
    keys: [key],
    arguments: [String(config.windowSeconds)],
  })) as number;

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
