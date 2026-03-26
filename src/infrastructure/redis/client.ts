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

export function createRedisClient(
  url = getRedisUrl(),
): RedisClient {
  const redis = createClient({ url }) as RedisClientType;

  redis.on('error', (err) => {
    console.error('Redis client error:', err);
  });

  return { redis };
}
