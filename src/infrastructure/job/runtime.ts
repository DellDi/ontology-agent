import { createJobUseCases } from '@/application/job/use-cases';
import { createRedisJobQueue } from '@/infrastructure/job/redis-job-queue';
import { createRedisClient } from '@/infrastructure/redis/client';

export async function withJobUseCases<T>(
  execute: (
    jobUseCases: ReturnType<typeof createJobUseCases>,
  ) => Promise<T>,
) {
  const { redis } = createRedisClient();
  await redis.connect();

  try {
    const jobUseCases = createJobUseCases({
      jobQueue: createRedisJobQueue(redis),
    });

    return await execute(jobUseCases);
  } finally {
    await redis.quit();
  }
}
