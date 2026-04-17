import { createClient, type RedisClientType } from 'redis';

export type RedisClient = {
  redis: RedisClientType;
};

function getRedisUrl() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('REDIS_URL is required to create the Redis client.');
  }

  return redisUrl;
}

type GlobalRedisCache = typeof globalThis & {
  __ontologyAgentRedisClient?: RedisClient;
  __ontologyAgentRedisUrl?: string;
};

function buildClient(url: string): RedisClient {
  const redis = createClient({ url }) as RedisClientType;
  redis.on('error', (err) => {
    console.error('Redis client error:', err);
  });
  return { redis };
}

export function createRedisClient(url = getRedisUrl()): RedisClient {
  // D3 / P2: 对默认 Redis URL 维护进程级单例，消除每次 health check 创建 + 销毁连接
  // 的资源 churn；显式传入非默认 URL 的调用方（测试）仍然获得独立实例。
  const scope = globalThis as GlobalRedisCache;
  if (url !== scope.__ontologyAgentRedisUrl) {
    scope.__ontologyAgentRedisUrl = url;
    scope.__ontologyAgentRedisClient = undefined;
  }
  if (!scope.__ontologyAgentRedisClient) {
    scope.__ontologyAgentRedisClient = buildClient(url);
  }
  return scope.__ontologyAgentRedisClient;
}

/**
 * 确保共享 Redis singleton 已连接；并发调用也只触发一次 connect。
 * health check 等场景可直接 `await ensureRedisConnected(redis)` 后执行 `ping`。
 */
export async function ensureRedisConnected(
  redis: RedisClientType,
): Promise<void> {
  if (redis.isOpen) {
    return;
  }
  const anyClient = redis as RedisClientType & {
    __ontologyAgentConnectInFlight?: Promise<void>;
  };
  if (anyClient.__ontologyAgentConnectInFlight) {
    await anyClient.__ontologyAgentConnectInFlight;
    return;
  }
  const pending = redis
    .connect()
    .then(() => undefined)
    .finally(() => {
      anyClient.__ontologyAgentConnectInFlight = undefined;
    });
  anyClient.__ontologyAgentConnectInFlight = pending;
  await pending;
}
