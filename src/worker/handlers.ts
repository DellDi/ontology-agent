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
  'analysis-execution': async (job) => {
    const plan = job.data.plan as
      | { steps?: { id?: string; order?: number; title?: string }[] }
      | undefined;

    return {
      executionId: job.id,
      sessionId: String(job.data.sessionId ?? ''),
      processedStepCount: Array.isArray(plan?.steps) ? plan.steps.length : 0,
      acceptedAt: new Date().toISOString(),
      stage: 'queued-for-stream',
    };
  },
};

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers[type];
}
