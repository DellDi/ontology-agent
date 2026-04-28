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

/**
 * 创建调用方独占的 Redis client。
 *
 * 谁创建谁关闭：适用于 worker 进程、测试、CLI、带超时销毁语义的短生命周期调用。
 * Web 请求路径如需复用连接，应显式使用 `getSharedRedisClient()`，避免误关共享连接。
 */
export function createRedisClient(url = getRedisUrl()): RedisClient {
  return buildClient(url);
}

/**
 * 获取进程级共享 Redis client。
 *
 * 调用方不得 `quit()` / `destroy()` 该实例；只允许通过 `ensureRedisConnected()` 确保连接。
 * 共享连接主要用于 Next.js route handler、health check、SSE 等 web 请求路径。
 */
export function getSharedRedisClient(url = getRedisUrl()): RedisClient {
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
