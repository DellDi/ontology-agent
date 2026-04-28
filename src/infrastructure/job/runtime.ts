import { createJobUseCases } from '@/application/job/use-cases';
import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { createPostgresBackedJobQueue } from '@/infrastructure/job/postgres-backed-job-queue';
import { createPostgresDb } from '@/infrastructure/postgres/client';
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
  const { db } = createPostgresDb();

  const jobUseCases = createJobUseCases({
    jobQueue: createPostgresBackedJobQueue({
      redis,
      db,
    }),
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
