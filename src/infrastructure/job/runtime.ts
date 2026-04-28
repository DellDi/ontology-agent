import { createJobUseCases } from '@/application/job/use-cases';
import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { createRedisJobQueue } from '@/infrastructure/job/redis-job-queue';
import {
  ensureRedisConnected,
  getSharedRedisClient,
} from '@/infrastructure/redis/client';

export async function withJobUseCases<T>(
  execute: (
    services: {
      jobUseCases: ReturnType<typeof createJobUseCases>;
      analysisExecutionStreamUseCases: ReturnType<
        typeof createAnalysisExecutionStreamUseCases
      >;
    },
  ) => Promise<T>,
) {
  const { redis } = getSharedRedisClient();
  await ensureRedisConnected(redis);

  const jobUseCases = createJobUseCases({
    jobQueue: createRedisJobQueue(redis),
  });
  const analysisExecutionStreamUseCases =
    createAnalysisExecutionStreamUseCases({
      eventStore: createRedisAnalysisExecutionEventStore(redis),
    });

  return await execute({
    jobUseCases,
    analysisExecutionStreamUseCases,
  });
}
