import type { RedisClientType } from 'redis';

export type RedisHealthResult = {
  ok: boolean;
  latencyMs: number;
};

export async function checkRedisHealth(
  redis: RedisClientType,
): Promise<RedisHealthResult> {
  const start = performance.now();

  try {
    const pong = await redis.ping();
    const latencyMs = Math.round(performance.now() - start);

    return { ok: pong === 'PONG', latencyMs };
  } catch {
    const latencyMs = Math.round(performance.now() - start);

    return { ok: false, latencyMs };
  }
}
