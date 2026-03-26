import type { Job } from '@/domain/job-contract/models';
import { checkRedisHealth } from '@/infrastructure/redis/health';
import type { RedisClientType } from 'redis';

export type JobHandler = (
  job: Job,
  context: { redis: RedisClientType },
) => Promise<Record<string, unknown>>;

const handlers: Record<string, JobHandler> = {
  'health-check': async (_job, { redis }) => {
    const health = await checkRedisHealth(redis);

    return {
      workerAlive: true,
      redisOk: health.ok,
      redisLatencyMs: health.latencyMs,
      timestamp: new Date().toISOString(),
    };
  },
};

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers[type];
}
